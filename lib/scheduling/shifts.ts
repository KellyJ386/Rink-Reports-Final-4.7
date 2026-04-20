import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { Shift } from './types'

export type AddShiftInput = {
  schedule_id: string
  position_resource_id: string
  starts_at: string
  ends_at: string
  notes?: string
  required_headcount?: number
}

export async function addShift(input: AddShiftInput): Promise<{ ok: true; shift: Shift } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('shifts')
    .insert({
      schedule_id: input.schedule_id,
      position_resource_id: input.position_resource_id,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      notes: input.notes ?? null,
      required_headcount: input.required_headcount ?? 1,
    })
    .select('*')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, shift: data as Shift }
}

export type UpdateShiftInput = {
  shift_id: string
  starts_at?: string
  ends_at?: string
  notes?: string | null
  required_headcount?: number
}

export async function updateShift(input: UpdateShiftInput): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const patch: Record<string, unknown> = {}
  if (input.starts_at) patch.starts_at = input.starts_at
  if (input.ends_at) patch.ends_at = input.ends_at
  if (Object.prototype.hasOwnProperty.call(input, 'notes')) patch.notes = input.notes
  if (typeof input.required_headcount === 'number')
    patch.required_headcount = input.required_headcount
  const { error } = await supabase.from('shifts').update(patch).eq('id', input.shift_id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function deleteShift(shiftId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('shifts').delete().eq('id', shiftId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export type AssignResult =
  | { ok: true }
  | { ok: false; code: 'overlap'; error: string; conflicting_shift_id?: string }
  | { ok: false; code: 'other'; error: string }

/**
 * Assign a user to a shift. Translates the Postgres exclusion_violation (23P01)
 * raised by the overlap-block trigger into a structured error the UI can display.
 */
export async function assignUserToShift(
  shiftId: string,
  userId: string,
): Promise<AssignResult> {
  const supabase = await createClient()
  const { data: actor } = await supabase.auth.getUser()
  const { error } = await supabase.from('shift_assignments').insert({
    shift_id: shiftId,
    user_id: userId,
    assigned_by: actor.user?.id ?? null,
  })
  if (!error) return { ok: true }

  if (error.code === '23P01') {
    const hint = (error as { hint?: string }).hint ?? ''
    const match = /conflicting_shift_id=([0-9a-f-]+)/.exec(hint)
    return {
      ok: false,
      code: 'overlap',
      error: error.message,
      conflicting_shift_id: match?.[1],
    }
  }
  return { ok: false, code: 'other', error: error.message }
}

export async function unassignUserFromShift(
  shiftId: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('shift_assignments')
    .delete()
    .eq('shift_id', shiftId)
    .eq('user_id', userId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Fetch shifts + assignments for a schedule. Returns rows grouped by shift. */
export async function fetchShiftsWithAssignments(scheduleId: string) {
  const supabase = await createClient()
  const { data: shifts } = await supabase
    .from('shifts')
    .select('*')
    .eq('schedule_id', scheduleId)
    .order('starts_at', { ascending: true })

  const shiftList = (shifts ?? []) as Shift[]
  if (shiftList.length === 0) return []

  const shiftIds = shiftList.map((s) => s.id)
  const { data: assignments } = await supabase
    .from('shift_assignments')
    .select('id, shift_id, user_id, assigned_at')
    .in('shift_id', shiftIds)

  const byShift = new Map<string, Array<{ user_id: string; assigned_at: string }>>()
  for (const a of (assignments ?? []) as Array<{
    shift_id: string
    user_id: string
    assigned_at: string
  }>) {
    const arr = byShift.get(a.shift_id) ?? []
    arr.push({ user_id: a.user_id, assigned_at: a.assigned_at })
    byShift.set(a.shift_id, arr)
  }

  return shiftList.map((s) => ({
    shift: s,
    assignments: byShift.get(s.id) ?? [],
  }))
}
