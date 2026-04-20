import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { IceDepthPoint, IceDepthTemplateSummary, SvgKey } from './types'

/**
 * Load every Ice Depth template in the current facility with the surface name joined
 * in. Used by /modules/ice-depth/templates (admin list).
 */
export async function listTemplates(): Promise<IceDepthTemplateSummary[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ice_depth_templates')
    .select(
      'id, facility_id, surface_resource_id, name, svg_key, version, is_published, updated_at, current_points, draft_points, facility_resources!inner(name)',
    )
    .order('name', { ascending: true })
  if (error) {
    console.error('listTemplates error', error)
    return []
  }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    facility_id: row.facility_id as string,
    surface_resource_id: row.surface_resource_id as string,
    surface_name:
      (row.facility_resources as { name?: string } | null)?.name ?? 'Surface',
    name: row.name as string,
    svg_key: row.svg_key as SvgKey,
    version: row.version as number,
    is_published: row.is_published as boolean,
    has_draft: row.draft_points !== null,
    current_points: (row.current_points as IceDepthPoint[]) ?? [],
    draft_points: (row.draft_points as IceDepthPoint[] | null) ?? null,
    updated_at: row.updated_at as string,
  }))
}

export async function loadTemplate(templateId: string): Promise<IceDepthTemplateSummary | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ice_depth_templates')
    .select(
      'id, facility_id, surface_resource_id, name, svg_key, version, is_published, updated_at, current_points, draft_points, facility_resources!inner(name)',
    )
    .eq('id', templateId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.error('loadTemplate error', error)
    return null
  }
  const row = data as Record<string, unknown>
  return {
    id: row.id as string,
    facility_id: row.facility_id as string,
    surface_resource_id: row.surface_resource_id as string,
    surface_name:
      (row.facility_resources as { name?: string } | null)?.name ?? 'Surface',
    name: row.name as string,
    svg_key: row.svg_key as SvgKey,
    version: row.version as number,
    is_published: row.is_published as boolean,
    has_draft: row.draft_points !== null,
    current_points: (row.current_points as IceDepthPoint[]) ?? [],
    draft_points: (row.draft_points as IceDepthPoint[] | null) ?? null,
    updated_at: row.updated_at as string,
  }
}

export async function loadHistoricalTemplateVersion(
  templateId: string,
  version: number,
): Promise<{ svg_key: SvgKey; points: IceDepthPoint[] } | null> {
  const supabase = await createClient()

  // Prefer history snapshot; fall back to current (for v1 sessions filed before any re-publish).
  const { data: histData } = await supabase
    .from('ice_depth_template_history')
    .select('svg_key, points')
    .eq('template_id', templateId)
    .eq('version', version)
    .maybeSingle()

  if (histData) {
    return {
      svg_key: histData.svg_key as SvgKey,
      points: (histData.points as IceDepthPoint[]) ?? [],
    }
  }

  const { data: current } = await supabase
    .from('ice_depth_templates')
    .select('svg_key, current_points, version')
    .eq('id', templateId)
    .maybeSingle()

  if (!current || current.version !== version) return null

  return {
    svg_key: current.svg_key as SvgKey,
    points: (current.current_points as IceDepthPoint[]) ?? [],
  }
}

// ----------------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------------

export type CreateTemplateInput = {
  surface_resource_id: string
  name: string
  svg_key: SvgKey
}

const DEFAULT_POINTS: IceDepthPoint[] = [
  { key: 'p1', label: 'Left goal crease',   x_pct: 10, y_pct: 50, sort_order: 1 },
  { key: 'p2', label: 'Left zone — top',    x_pct: 25, y_pct: 30, sort_order: 2 },
  { key: 'p3', label: 'Left zone — bottom', x_pct: 25, y_pct: 70, sort_order: 3 },
  { key: 'p4', label: 'Neutral — top',      x_pct: 50, y_pct: 25, sort_order: 4 },
  { key: 'p5', label: 'Neutral — bottom',   x_pct: 50, y_pct: 75, sort_order: 5 },
  { key: 'p6', label: 'Right zone — top',   x_pct: 75, y_pct: 30, sort_order: 6 },
  { key: 'p7', label: 'Right zone — bottom',x_pct: 75, y_pct: 70, sort_order: 7 },
  { key: 'p8', label: 'Right goal crease',  x_pct: 90, y_pct: 50, sort_order: 8 },
]

export async function createTemplate(
  input: CreateTemplateInput,
): Promise<{ ok: true; template_id: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ice_depth_templates')
    .insert({
      surface_resource_id: input.surface_resource_id,
      name: input.name,
      svg_key: input.svg_key,
      current_points: DEFAULT_POINTS,
      version: 1,
      is_published: true,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }
  return { ok: true, template_id: data.id as string }
}

export type SaveTemplateDraftInput = {
  template_id: string
  draft_points?: IceDepthPoint[]
  name?: string
  svg_key?: SvgKey
}

export async function saveTemplateDraft(
  input: SaveTemplateDraftInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const validation = validatePoints(input.draft_points)
  if (!validation.ok) return validation

  const supabase = await createClient()
  const { error } = await supabase.rpc('rpc_save_ice_depth_template_draft', {
    p_template_id: input.template_id,
    p_draft_points: input.draft_points ?? null,
    p_name: input.name ?? null,
    p_svg_key: input.svg_key ?? null,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function publishTemplate(
  templateId: string,
): Promise<{ ok: true; new_version: number } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rpc_publish_ice_depth_template', {
    p_template_id: templateId,
  })
  if (error) return { ok: false, error: error.message }
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.new_version) return { ok: false, error: 'publish RPC returned no version' }
  return { ok: true, new_version: row.new_version as number }
}

export async function discardTemplateDraft(
  templateId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('rpc_discard_ice_depth_template_draft', {
    p_template_id: templateId,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ----------------------------------------------------------------------------
// Validation (client-visible; SQL layer re-validates for defense in depth)
// ----------------------------------------------------------------------------

function validatePoints(
  points: IceDepthPoint[] | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!points) return { ok: true }
  if (!Array.isArray(points) || points.length === 0) {
    return { ok: false, error: 'Template must have at least one measurement point.' }
  }
  const seenKeys = new Set<string>()
  for (const p of points) {
    if (!p.key || !/^[a-z0-9][a-z0-9_]*$/.test(p.key)) {
      return { ok: false, error: `Invalid point key "${p.key}". Use snake_case.` }
    }
    if (seenKeys.has(p.key)) {
      return { ok: false, error: `Duplicate point key "${p.key}".` }
    }
    seenKeys.add(p.key)
    if (!p.label || p.label.trim().length === 0) {
      return { ok: false, error: `Point "${p.key}" must have a label.` }
    }
    if (!(p.x_pct >= 0 && p.x_pct <= 100)) {
      return { ok: false, error: `Point "${p.key}" x must be 0-100.` }
    }
    if (!(p.y_pct >= 0 && p.y_pct <= 100)) {
      return { ok: false, error: `Point "${p.key}" y must be 0-100.` }
    }
  }
  return { ok: true }
}

export { DEFAULT_POINTS }
