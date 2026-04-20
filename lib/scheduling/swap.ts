import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { publishNotification } from '@/lib/notifications/publish'
import { logger } from '@/lib/observability/logger'

import { loadSchedulingSettings } from './settings'
import type { ShiftSwapRequest } from './types'

export type ProposeSwapInput = {
  requester_shift_id: string
  target_user_id: string
  target_shift_id?: string | null
  idempotency_key?: string
}

export async function proposeSwap(
  input: ProposeSwapInput,
): Promise<{ ok: true; swap: ShiftSwapRequest } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return { ok: false, error: 'not_authenticated' }

  const { data: inserted, error } = await supabase
    .from('shift_swap_requests')
    .insert({
      requester_user_id: user.user.id,
      requester_shift_id: input.requester_shift_id,
      target_user_id: input.target_user_id,
      target_shift_id: input.target_shift_id ?? null,
      idempotency_key: input.idempotency_key ?? null,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505' && input.idempotency_key) {
      const { data: existing } = await supabase
        .from('shift_swap_requests')
        .select('*')
        .eq('idempotency_key', input.idempotency_key)
        .maybeSingle()
      if (existing) return { ok: true, swap: existing as ShiftSwapRequest }
    }
    return { ok: false, error: error.message }
  }

  const swap = inserted as ShiftSwapRequest

  // Lookup requester name for payload prettiness
  const { data: requester } = await supabase
    .from('users')
    .select('full_name, email')
    .eq('id', user.user.id)
    .maybeSingle()
  const requesterName =
    (requester?.full_name as string | null) ?? (requester?.email as string | null) ?? 'Colleague'

  await publishNotification({
    user_id: swap.target_user_id,
    kind: 'swap.proposed',
    payload: {
      swap_id: swap.id,
      requester_user_id: swap.requester_user_id,
      requester_shift_id: swap.requester_shift_id,
      target_shift_id: swap.target_shift_id,
      requester_name: requesterName,
    },
  })

  return { ok: true, swap }
}

export async function acceptSwap(
  swapId: string,
): Promise<{ ok: true; status: string; reassigned: boolean } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('rpc_swap_accept', { p_swap_id: swapId })
    .single()

  if (error) return { ok: false, error: error.message }

  const row = data as { swap_id: string; new_status: string; reassigned: boolean } | null
  if (!row) return { ok: false, error: 'rpc returned no row' }

  // Side notifications: requester always; managers when pending_manager
  const { data: swap } = await supabase
    .from('shift_swap_requests')
    .select('*')
    .eq('id', swapId)
    .maybeSingle()

  if (swap) {
    const s = swap as ShiftSwapRequest
    if (row.reassigned) {
      // free mode: both parties already notified via swap.decided
      await publishNotification({
        user_id: s.requester_user_id,
        kind: 'swap.decided',
        payload: { swap_id: s.id, status: 'approved', mode: 'free' },
      })
      await publishNotification({
        user_id: s.target_user_id,
        kind: 'swap.decided',
        payload: { swap_id: s.id, status: 'approved', mode: 'free' },
      })
    } else {
      // manager_approval mode: requester notified that target accepted;
      // managers notified that the swap is pending their approval
      await publishNotification({
        user_id: s.requester_user_id,
        kind: 'swap.accepted_by_target',
        payload: { swap_id: s.id },
      })

      const { data: managerRows } = await supabase
        .from('user_roles')
        .select(
          'user_id, roles!inner(id, facility_id, role_module_access!inner(access_level, modules!inner(slug)))',
        )
        .eq('roles.facility_id', s.facility_id)
        .eq('roles.role_module_access.access_level', 'admin')
        .eq('roles.role_module_access.modules.slug', 'scheduling')

      const managerIds = new Set<string>()
      for (const row of (managerRows ?? []) as Array<{ user_id: string }>) {
        if (row.user_id !== s.requester_user_id && row.user_id !== s.target_user_id) {
          managerIds.add(row.user_id)
        }
      }
      for (const mid of managerIds) {
        await publishNotification({
          user_id: mid,
          kind: 'swap.accepted_by_target',
          payload: { swap_id: s.id },
        })
      }
    }
  }

  return { ok: true, status: row.new_status, reassigned: row.reassigned }
}

export async function managerDecideSwap(
  swapId: string,
  decision: 'approved' | 'denied',
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('rpc_swap_manager_decide', {
      p_swap_id: swapId,
      p_decision: decision,
      p_note: note ?? null,
    })
    .single()

  if (error) return { ok: false, error: error.message }

  const row = data as { swap_id: string; new_status: string } | null
  if (!row) return { ok: true }

  const { data: swap } = await supabase
    .from('shift_swap_requests')
    .select('requester_user_id, target_user_id')
    .eq('id', swapId)
    .maybeSingle()
  if (swap) {
    const s = swap as Pick<ShiftSwapRequest, 'requester_user_id' | 'target_user_id'>
    for (const uid of [s.requester_user_id, s.target_user_id]) {
      await publishNotification({
        user_id: uid,
        kind: 'swap.decided',
        payload: { swap_id: swapId, status: decision, note: note ?? null },
      })
    }
  }

  return { ok: true }
}

export async function withdrawSwap(swapId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('rpc_swap_withdraw', { p_swap_id: swapId })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function fetchMySwaps(): Promise<ShiftSwapRequest[]> {
  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return []
  const uid = user.user.id
  const { data } = await supabase
    .from('shift_swap_requests')
    .select('*')
    .or(`requester_user_id.eq.${uid},target_user_id.eq.${uid}`)
    .order('created_at', { ascending: false })
  return (data ?? []) as ShiftSwapRequest[]
}

export async function fetchPendingManagerSwaps(): Promise<ShiftSwapRequest[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('shift_swap_requests')
    .select('*')
    .eq('status', 'pending_manager')
    .order('created_at', { ascending: true })
  return (data ?? []) as ShiftSwapRequest[]
}

export async function currentSwapApprovalMode() {
  const s = await loadSchedulingSettings()
  return s.swap_approval_mode
}

// Retained so callers can log decision outcomes without a new code path.
export function logSwapAction(action: string, details: Record<string, unknown>) {
  logger.info(`scheduling.swap.${action}`, details)
}
