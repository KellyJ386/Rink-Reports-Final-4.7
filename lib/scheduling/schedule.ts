import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { publishNotification } from '@/lib/notifications/publish'
import { logger } from '@/lib/observability/logger'

import type { Schedule, ShiftAssignment } from './types'
import { shiftWeek } from './week'

export type CreateScheduleResult =
  | { ok: true; schedule: Schedule; already_existed: boolean }
  | { ok: false; error: string }

/**
 * Create (or retrieve the existing) schedule row for the given week. Idempotent
 * on the partial unique index (facility_id, week_start_date).
 */
export async function createOrGetScheduleForWeek(
  weekStartDate: string,
): Promise<CreateScheduleResult> {
  const supabase = await createClient()
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return { ok: false, error: 'not_authenticated' }

  const { data: existing } = await supabase
    .from('schedules')
    .select('*')
    .eq('week_start_date', weekStartDate)
    .maybeSingle()

  if (existing) {
    return { ok: true, schedule: existing as Schedule, already_existed: true }
  }

  const { data: inserted, error } = await supabase
    .from('schedules')
    .insert({
      week_start_date: weekStartDate,
      created_by: user.user.id,
    })
    .select('*')
    .single()

  if (error) return { ok: false, error: error.message }
  return { ok: true, schedule: inserted as Schedule, already_existed: false }
}

export async function fetchScheduleByWeek(weekStartDate: string): Promise<Schedule | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('schedules')
    .select('*')
    .eq('week_start_date', weekStartDate)
    .maybeSingle()
  return (data as Schedule) ?? null
}

export async function fetchSchedulesList(limit = 20): Promise<Schedule[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('schedules')
    .select('*')
    .order('week_start_date', { ascending: false })
    .limit(limit)
  return (data as Schedule[]) ?? []
}

export type PublishResult =
  | { ok: true; assigned_user_ids: string[] }
  | { ok: false; error: string }

/**
 * Publish a schedule and notify all assigned users. The RPC flips state + audit
 * atomically; the notification fan-out happens here after the RPC returns so
 * we don't hold DB locks during the serial publishNotification loop.
 */
export async function publishSchedule(scheduleId: string): Promise<PublishResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('rpc_publish_schedule', { p_schedule_id: scheduleId })
    .single()

  if (error) {
    logger.error('schedule.publish.failed', { error: error.message, scheduleId })
    return { ok: false, error: error.message }
  }

  const row = data as {
    schedule_id: string
    week_start_date: string
    assigned_user_ids: string[]
  } | null
  if (!row) return { ok: false, error: 'rpc_publish_schedule returned no row' }

  const userIds = (row.assigned_user_ids ?? []).filter(Boolean)
  for (const userId of userIds) {
    await publishNotification({
      user_id: userId,
      kind: 'schedule.published',
      payload: {
        schedule_id: row.schedule_id,
        week_start_date: row.week_start_date,
      },
    })
  }

  return { ok: true, assigned_user_ids: userIds }
}

export async function reopenSchedule(scheduleId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('rpc_reopen_schedule', { p_schedule_id: scheduleId })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function archiveSchedule(scheduleId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('rpc_archive_schedule', { p_schedule_id: scheduleId })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Fetch a user's shifts for a week. Returns rows joined with shift + schedule
 * metadata so the UI can show position name + co-workers without a second call.
 */
export async function fetchMyShiftsForWeek(weekStartISO: string) {
  const supabase = await createClient()
  const weekEnd = shiftWeek(weekStartISO, 1)

  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return []

  const { data } = await supabase
    .from('shift_assignments')
    .select(
      'id, user_id, shift:shifts!inner(id, starts_at, ends_at, notes, position_resource_id, schedule_id, position:facility_resources!inner(id, name))',
    )
    .eq('user_id', user.user.id)
    .gte('shift.starts_at', `${weekStartISO}T00:00:00Z`)
    .lt('shift.starts_at', `${weekEnd}T00:00:00Z`)
    .order('starts_at', { ascending: true, foreignTable: 'shifts' })

  return (data ?? []) as unknown as Array<{
    id: string
    user_id: string
    shift: {
      id: string
      starts_at: string
      ends_at: string
      notes: string | null
      position_resource_id: string
      schedule_id: string
      position: { id: string; name: string }
    }
  }>
}

/**
 * Notify users affected by a post-publish edit. Compares the previous
 * assignment set to the current one and publishes `schedule.edited_after_publish`
 * to any user who either lost or gained an assignment.
 */
export async function notifyAffectedUsersAfterEdit(
  scheduleId: string,
  previousUserIds: string[],
  currentUserIds: string[],
  weekStartDate: string,
) {
  const before = new Set(previousUserIds)
  const after = new Set(currentUserIds)
  const affected = new Set<string>()
  for (const u of before) if (!after.has(u)) affected.add(u)
  for (const u of after) if (!before.has(u)) affected.add(u)

  for (const userId of affected) {
    await publishNotification({
      user_id: userId,
      kind: 'schedule.edited_after_publish',
      payload: { schedule_id: scheduleId, week_start_date: weekStartDate },
    })
  }
}

/** Who is currently assigned to any shift in the given schedule. */
export async function listScheduleAssignedUserIds(scheduleId: string): Promise<string[]> {
  const svc = createServiceClient()
  const { data } = await svc
    .from('shift_assignments')
    .select('user_id, shift:shifts!inner(schedule_id)')
    .eq('shift.schedule_id', scheduleId)
  const ids = new Set<string>()
  for (const row of (data ?? []) as unknown as Array<{ user_id: string }>) {
    ids.add(row.user_id)
  }
  return Array.from(ids)
}

export type { ShiftAssignment }
