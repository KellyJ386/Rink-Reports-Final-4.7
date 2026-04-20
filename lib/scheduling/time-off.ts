import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { publishNotification } from '@/lib/notifications/publish'
import { logger } from '@/lib/observability/logger'

import type { TimeOffRequest } from './types'

export type SubmitTimeOffInput = {
  starts_at: string
  ends_at: string
  reason?: string
  idempotency_key?: string
}

export type SubmitResult =
  | { ok: true; request: TimeOffRequest }
  | { ok: false; error: string }

export async function submitTimeOff(input: SubmitTimeOffInput): Promise<SubmitResult> {
  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return { ok: false, error: 'not_authenticated' }

  const { data: inserted, error } = await supabase
    .from('time_off_requests')
    .insert({
      user_id: user.user.id,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      reason: input.reason ?? null,
      idempotency_key: input.idempotency_key ?? null,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505' && input.idempotency_key) {
      const { data: existing } = await supabase
        .from('time_off_requests')
        .select('*')
        .eq('idempotency_key', input.idempotency_key)
        .maybeSingle()
      if (existing) return { ok: true, request: existing as TimeOffRequest }
    }
    return { ok: false, error: error.message }
  }

  // Notify managers. Managers = users with scheduling admin module access in
  // this facility. Enumerate via user_roles → role_module_access join.
  void fanOutTimeOffSubmitted(inserted as TimeOffRequest).catch((e: unknown) => {
    logger.warn('time_off.submit.notify_failed', {
      error: e instanceof Error ? e.message : String(e),
    })
  })

  return { ok: true, request: inserted as TimeOffRequest }
}

async function fanOutTimeOffSubmitted(req: TimeOffRequest) {
  const supabase = await createClient()
  const { data: requester } = await supabase
    .from('users')
    .select('full_name, email')
    .eq('id', req.user_id)
    .maybeSingle()

  const requesterName =
    (requester?.full_name as string | null) ?? (requester?.email as string | null) ?? 'Staff'

  const { data: managers } = await supabase
    .from('role_module_access')
    .select('roles!inner(id, facility_id), user_roles:user_roles!inner(user_id, roles!inner(id))')
    .eq('access_level', 'admin')
    .eq('modules.slug', 'scheduling')
    .eq('roles.facility_id', req.facility_id)

  // Fallback query path if the above join shape doesn't resolve cleanly in
  // PostgREST: read user_roles for roles with admin scheduling access.
  const { data: managerRows } = await supabase
    .from('user_roles')
    .select(
      'user_id, roles!inner(id, facility_id, role_module_access!inner(access_level, modules!inner(slug)))',
    )
    .eq('roles.facility_id', req.facility_id)
    .eq('roles.role_module_access.access_level', 'admin')
    .eq('roles.role_module_access.modules.slug', 'scheduling')

  const managerUserIds = new Set<string>()
  for (const row of (managerRows ?? []) as Array<{ user_id: string }>) {
    managerUserIds.add(row.user_id)
  }
  // Also accept the first query path if it returned rows
  if (Array.isArray(managers)) {
    // no-op — PostgREST join shape didn't give us user_id directly here; safe fallback above
  }

  for (const managerUserId of managerUserIds) {
    if (managerUserId === req.user_id) continue
    await publishNotification({
      user_id: managerUserId,
      kind: 'time_off.submitted',
      payload: {
        request_id: req.id,
        requester_user_id: req.user_id,
        requester_name: requesterName,
        starts_at: req.starts_at,
        ends_at: req.ends_at,
      },
    })
  }
}

export type DecideInput = {
  request_id: string
  decision: 'approved' | 'denied'
  note?: string
}

export async function decideTimeOff(
  input: DecideInput,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('rpc_time_off_decide', {
      p_request_id: input.request_id,
      p_decision: input.decision,
      p_note: input.note ?? null,
    })
    .single()

  if (error) return { ok: false, error: error.message }

  const row = data as { request_id: string; user_id: string; status: string } | null
  if (!row) return { ok: true }

  await publishNotification({
    user_id: row.user_id,
    kind: 'time_off.decided',
    payload: {
      request_id: row.request_id,
      status: row.status,
      note: input.note ?? null,
    },
  })

  return { ok: true }
}

export async function withdrawTimeOff(
  requestId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('rpc_time_off_withdraw', { p_request_id: requestId })
    .single()

  if (error) return { ok: false, error: error.message }

  const row = data as {
    request_id: string
    previous_status: string
    notify_manager_user_id: string | null
  } | null

  // If the request had been approved and the manager is identified, notify them.
  if (row?.previous_status === 'approved' && row.notify_manager_user_id) {
    await publishNotification({
      user_id: row.notify_manager_user_id,
      kind: 'time_off.withdrawn_after_approval',
      payload: { request_id: row.request_id },
    })
  }

  return { ok: true }
}

export async function fetchMyTimeOffRequests(): Promise<TimeOffRequest[]> {
  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return []
  const { data } = await supabase
    .from('time_off_requests')
    .select('*')
    .eq('user_id', user.user.id)
    .order('starts_at', { ascending: false })
  return (data ?? []) as TimeOffRequest[]
}

export async function fetchPendingTimeOffForFacility(): Promise<TimeOffRequest[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('time_off_requests')
    .select('*')
    .eq('status', 'pending')
    .order('starts_at', { ascending: true })
  return (data ?? []) as TimeOffRequest[]
}
