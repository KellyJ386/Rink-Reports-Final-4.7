import 'server-only'

import { createClient } from '@/lib/supabase/server'

import { loadHistoricalTemplateVersion, loadTemplate } from './template'
import type {
  CompleteSessionResult,
  IceDepthPoint,
  IceDepthReading,
  IceDepthSession,
  RecordReadingInput,
  SessionStartInput,
  SessionStartResult,
  SvgKey,
} from './types'

/**
 * Start a new session against a template. Uses the template's current version
 * (not history). Idempotent via idempotency_key: starting twice with the same key
 * returns the same session id + `idempotent_return: true`.
 */
export async function startSession(input: SessionStartInput): Promise<SessionStartResult> {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !user) return { ok: false, error: 'Not authenticated' }

  const template = await loadTemplate(input.template_id)
  if (!template) return { ok: false, error: 'Template not found' }

  // Insert; on conflict on (facility_id, idempotency_key), re-select the existing session.
  const { data: inserted, error: insertError } = await supabase
    .from('ice_depth_sessions')
    .insert({
      template_id: template.id,
      surface_resource_id: template.surface_resource_id,
      form_schema_version: template.version,
      submitted_by: user.id,
      idempotency_key: input.idempotency_key ?? null,
      status: 'in_progress',
    })
    .select('id, form_schema_version')
    .maybeSingle()

  if (insertError) {
    if (input.idempotency_key && insertError.code === '23505') {
      const { data: existing } = await supabase
        .from('ice_depth_sessions')
        .select('id, form_schema_version')
        .eq('idempotency_key', input.idempotency_key)
        .maybeSingle()
      if (existing) {
        return {
          ok: true,
          session_id: existing.id as string,
          template_version: existing.form_schema_version as number,
          svg_key: template.svg_key,
          points: template.current_points,
          idempotent_return: true,
        }
      }
    }
    return { ok: false, error: insertError.message }
  }
  if (!inserted) return { ok: false, error: 'Insert returned no row' }

  // Audit (best-effort)
  void supabase
    .from('audit_log')
    .insert({
      facility_id: template.facility_id,
      actor_user_id: user.id,
      action: 'ice_depth_session.started',
      entity_type: 'ice_depth_session',
      entity_id: inserted.id as string,
      metadata: {
        template_id: template.id,
        template_version: template.version,
      },
    })
    .then(({ error }) => {
      if (error) console.error('startSession audit failed', error)
    })

  return {
    ok: true,
    session_id: inserted.id as string,
    template_version: inserted.form_schema_version as number,
    svg_key: template.svg_key,
    points: template.current_points,
    idempotent_return: false,
  }
}

/**
 * Record (or overwrite) a depth reading at a point. Upsert on (session_id, point_key).
 */
export async function recordReading(
  input: RecordReadingInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(input.depth_mm >= 0 && input.depth_mm <= 500)) {
    return { ok: false, error: 'Depth must be between 0 and 500 mm.' }
  }
  if (!/^[a-z0-9][a-z0-9_]*$/.test(input.point_key)) {
    return { ok: false, error: 'Invalid point key.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('ice_depth_readings').upsert(
    {
      session_id: input.session_id,
      point_key: input.point_key,
      depth_mm: input.depth_mm,
      recorded_at: new Date().toISOString(),
    },
    { onConflict: 'session_id,point_key' },
  )

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function completeSession(sessionId: string): Promise<CompleteSessionResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rpc_complete_ice_depth_session', {
    p_session_id: sessionId,
  })
  if (error) return { ok: false, error: error.message }
  const row = Array.isArray(data) ? data[0] : data
  const missing = (row?.missing_point_keys as string[] | null) ?? []
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Session incomplete: ${missing.length} point(s) still need a reading.`,
      missing_point_keys: missing,
    }
  }
  return { ok: true }
}

// ----------------------------------------------------------------------------
// Reads for session history + detail
// ----------------------------------------------------------------------------

export type SessionWithTemplateContext = {
  session: IceDepthSession
  svg_key: SvgKey
  points: IceDepthPoint[]
  readings: IceDepthReading[]
  surface_name: string
}

export async function loadSessionForDetail(
  sessionId: string,
): Promise<SessionWithTemplateContext | null> {
  const supabase = await createClient()

  const { data: session } = await supabase
    .from('ice_depth_sessions')
    .select(
      'id, facility_id, template_id, form_schema_version, surface_resource_id, status, submitted_by, submitted_at, notes, facility_resources!inner(name)',
    )
    .eq('id', sessionId)
    .maybeSingle()

  if (!session) return null

  const template = await loadHistoricalTemplateVersion(
    session.template_id as string,
    session.form_schema_version as number,
  )
  if (!template) return null

  const { data: readings } = await supabase
    .from('ice_depth_readings')
    .select('session_id, point_key, depth_mm, recorded_at')
    .eq('session_id', sessionId)

  return {
    session: {
      id: session.id as string,
      facility_id: session.facility_id as string,
      template_id: session.template_id as string,
      form_schema_version: session.form_schema_version as number,
      surface_resource_id: session.surface_resource_id as string,
      status: session.status as IceDepthSession['status'],
      submitted_by: session.submitted_by as string,
      submitted_at: session.submitted_at as string,
      notes: (session.notes as string | null) ?? null,
    },
    svg_key: template.svg_key,
    points: template.points,
    readings: (readings as IceDepthReading[]) ?? [],
    surface_name:
      (session.facility_resources as { name?: string } | null)?.name ?? 'Surface',
  }
}

export type SessionListItem = {
  id: string
  submitted_at: string
  status: IceDepthSession['status']
  surface_name: string
  submitted_by_name: string | null
  form_schema_version: number
}

export async function listSessions(limit = 50): Promise<SessionListItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ice_depth_sessions')
    .select(
      'id, submitted_at, status, form_schema_version, facility_resources!inner(name), users:submitted_by(full_name)',
    )
    .order('submitted_at', { ascending: false })
    .limit(limit)

  if (error || !data) {
    if (error) console.error('listSessions error', error)
    return []
  }

  return data.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    submitted_at: row.submitted_at as string,
    status: row.status as IceDepthSession['status'],
    form_schema_version: row.form_schema_version as number,
    surface_name:
      (row.facility_resources as { name?: string } | null)?.name ?? 'Surface',
    submitted_by_name:
      (row.users as { full_name?: string } | null)?.full_name ?? null,
  }))
}

// ----------------------------------------------------------------------------
// Trends query
// ----------------------------------------------------------------------------

export type TrendPoint = {
  session_id: string
  submitted_at: string
  point_key: string
  depth_mm: number
}

export async function loadTrendReadings(input: {
  surfaceResourceId: string
  fromDate?: string // ISO date
  toDate?: string
}): Promise<TrendPoint[]> {
  const supabase = await createClient()
  let query = supabase
    .from('ice_depth_readings')
    .select(
      'point_key, depth_mm, recorded_at, ice_depth_sessions!inner(id, submitted_at, status, surface_resource_id)',
    )
    .eq('ice_depth_sessions.status', 'completed')
    .eq('ice_depth_sessions.surface_resource_id', input.surfaceResourceId)
    .order('recorded_at', { ascending: true })

  if (input.fromDate) query = query.gte('ice_depth_sessions.submitted_at', input.fromDate)
  if (input.toDate) query = query.lte('ice_depth_sessions.submitted_at', input.toDate)

  const { data, error } = await query
  if (error || !data) {
    if (error) console.error('loadTrendReadings error', error)
    return []
  }

  return data.map((row: Record<string, unknown>) => {
    const sess = row.ice_depth_sessions as { id: string; submitted_at: string }
    return {
      session_id: sess.id,
      submitted_at: sess.submitted_at,
      point_key: row.point_key as string,
      depth_mm: Number(row.depth_mm),
    }
  })
}
