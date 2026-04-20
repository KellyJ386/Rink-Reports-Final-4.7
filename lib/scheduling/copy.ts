import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/observability/logger'

import { shiftWeek, weekFourBack } from './week'
import type { Shift } from './types'

export type CopyMode = 'previous-week' | 'four-weeks-back'

export type CopyResult =
  | { ok: true; shifts_inserted: number }
  | { ok: false; error: string; code?: string }

/**
 * Copy shifts from a source week into the target week's schedule. If the
 * target schedule has existing shifts, the caller must confirm — we reject
 * unless `force = true`.
 *
 * `include_assignments = true` carries over shift_assignments. Overlap-block
 * trigger may still reject individual users if their carry-over would collide
 * with another shift; those failures are logged but don't abort the copy.
 *
 * copy-previous-month is 4 Sundays back (exactly 28 days). Deterministic; see
 * SCHEDULING.md for why we don't use calendar-week-of-month.
 */
export async function copyShifts(input: {
  target_schedule_id: string
  mode: CopyMode
  include_assignments: boolean
  force: boolean
}): Promise<CopyResult> {
  const supabase = await createClient()

  const { data: target } = await supabase
    .from('schedules')
    .select('id, week_start_date, status')
    .eq('id', input.target_schedule_id)
    .maybeSingle()
  if (!target) return { ok: false, error: 'target_schedule_not_found' }
  if (target.status !== 'draft') {
    return { ok: false, error: 'target_must_be_draft' }
  }

  const targetWeek = target.week_start_date as string
  const sourceWeek =
    input.mode === 'previous-week' ? shiftWeek(targetWeek, -1) : weekFourBack(targetWeek)

  const { data: existing } = await supabase
    .from('shifts')
    .select('id')
    .eq('schedule_id', target.id)
  if ((existing ?? []).length > 0 && !input.force) {
    return { ok: false, error: 'target_has_shifts', code: 'requires_confirm' }
  }

  // Load source schedule + shifts
  const { data: source } = await supabase
    .from('schedules')
    .select('id')
    .eq('week_start_date', sourceWeek)
    .maybeSingle()
  if (!source) return { ok: false, error: 'source_schedule_not_found' }

  const { data: sourceShifts } = await supabase
    .from('shifts')
    .select('*')
    .eq('schedule_id', source.id)

  const shifts = (sourceShifts ?? []) as Shift[]
  if (shifts.length === 0) return { ok: true, shifts_inserted: 0 }

  // Delete existing drafts in the target (force path)
  if ((existing ?? []).length > 0) {
    await supabase.from('shifts').delete().eq('schedule_id', target.id)
  }

  // Time shift offset: targetWeek - sourceWeek days. We compute the offset as a
  // difference in ISO dates (UTC date boundaries align with facility timezone
  // enough for this use; SCHEDULING.md documents the simplification).
  const offsetMs =
    new Date(targetWeek + 'T00:00:00Z').getTime() - new Date(sourceWeek + 'T00:00:00Z').getTime()

  const toInsert = shifts.map((s) => ({
    schedule_id: target.id,
    position_resource_id: s.position_resource_id,
    starts_at: new Date(new Date(s.starts_at).getTime() + offsetMs).toISOString(),
    ends_at: new Date(new Date(s.ends_at).getTime() + offsetMs).toISOString(),
    notes: s.notes,
    required_headcount: s.required_headcount,
  }))

  const { data: inserted, error: insErr } = await supabase
    .from('shifts')
    .insert(toInsert)
    .select('id, starts_at')

  if (insErr) return { ok: false, error: insErr.message }

  const insertedShifts = (inserted ?? []) as Array<{ id: string; starts_at: string }>
  let insertedCount = insertedShifts.length

  if (input.include_assignments && insertedShifts.length > 0) {
    // Map old shifts → new shifts by starts_at after offset. Simple because we
    // just inserted them with known offsets.
    const sourceIdByStartMs = new Map<number, string>()
    for (const s of shifts) {
      sourceIdByStartMs.set(new Date(s.starts_at).getTime(), s.id)
    }

    const { data: sourceAssignments } = await supabase
      .from('shift_assignments')
      .select('shift_id, user_id')
      .in('shift_id', shifts.map((s) => s.id))

    const newShiftIdByStartMs = new Map<number, string>()
    for (const s of insertedShifts) {
      newShiftIdByStartMs.set(new Date(s.starts_at).getTime(), s.id)
    }

    for (const a of (sourceAssignments ?? []) as Array<{
      shift_id: string
      user_id: string
    }>) {
      // Find the matching new shift by applying offset to the source shift's starts_at
      const src = shifts.find((x) => x.id === a.shift_id)
      if (!src) continue
      const newStartMs = new Date(src.starts_at).getTime() + offsetMs
      const newShiftId = newShiftIdByStartMs.get(newStartMs)
      if (!newShiftId) continue

      const { error: e } = await supabase
        .from('shift_assignments')
        .insert({ shift_id: newShiftId, user_id: a.user_id })
      if (e && e.code === '23P01') {
        logger.info('scheduling.copy.assignment_overlap_skipped', {
          shift_id: newShiftId,
          user_id: a.user_id,
        })
      } else if (e) {
        logger.warn('scheduling.copy.assignment_error', {
          shift_id: newShiftId,
          user_id: a.user_id,
          error: e.message,
        })
      }
    }
  }

  return { ok: true, shifts_inserted: insertedCount }
}
