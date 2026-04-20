'use server'

import { revalidatePath } from 'next/cache'

import { requireActiveSubscription } from '@/lib/billing/require-active-subscription'
import {
  createOrGetScheduleForWeek,
  publishSchedule,
  reopenSchedule,
  archiveSchedule,
  listScheduleAssignedUserIds,
  notifyAffectedUsersAfterEdit,
} from '@/lib/scheduling/schedule'
import {
  addShift,
  updateShift,
  deleteShift,
  assignUserToShift,
  unassignUserFromShift,
  type AddShiftInput,
  type UpdateShiftInput,
} from '@/lib/scheduling/shifts'
import {
  replaceTemplate,
  replaceOverridesForWeek,
  type TemplateBlockInput,
} from '@/lib/scheduling/availability'
import {
  submitTimeOff,
  decideTimeOff,
  withdrawTimeOff,
  type SubmitTimeOffInput,
} from '@/lib/scheduling/time-off'
import {
  proposeSwap,
  acceptSwap,
  managerDecideSwap,
  withdrawSwap,
  type ProposeSwapInput,
} from '@/lib/scheduling/swap'
import { copyShifts, type CopyMode } from '@/lib/scheduling/copy'
import { createClient } from '@/lib/supabase/server'

async function gate() {
  const s = await requireActiveSubscription()
  if (!s.ok) return { ok: false as const, error: `subscription_${s.reason}` }
  return { ok: true as const }
}

export async function createScheduleAction(weekStartDate: string) {
  const g = await gate()
  if (!g.ok) return g
  const r = await createOrGetScheduleForWeek(weekStartDate)
  if (r.ok) revalidatePath(`/modules/scheduling/manage/${weekStartDate}`)
  return r
}

export async function publishScheduleAction(scheduleId: string, weekStartDate: string) {
  const g = await gate()
  if (!g.ok) return g
  const r = await publishSchedule(scheduleId)
  if (r.ok) {
    revalidatePath(`/modules/scheduling/manage/${weekStartDate}`)
    revalidatePath(`/modules/scheduling`)
    revalidatePath(`/modules/scheduling/week/${weekStartDate}`)
  }
  return r
}

export async function reopenScheduleAction(scheduleId: string, weekStartDate: string) {
  const g = await gate()
  if (!g.ok) return g
  const r = await reopenSchedule(scheduleId)
  if (r.ok) {
    revalidatePath(`/modules/scheduling/manage/${weekStartDate}`)
    revalidatePath(`/modules/scheduling/week/${weekStartDate}`)
  }
  return r
}

export async function archiveScheduleAction(scheduleId: string, weekStartDate: string) {
  const g = await gate()
  if (!g.ok) return g
  const r = await archiveSchedule(scheduleId)
  if (r.ok) {
    revalidatePath('/modules/scheduling/manage')
    revalidatePath(`/modules/scheduling/manage/${weekStartDate}`)
  }
  return r
}

export async function addShiftAction(scheduleId: string, weekStartDate: string, input: Omit<AddShiftInput, 'schedule_id'>) {
  const g = await gate()
  if (!g.ok) return g
  const previous = await listScheduleAssignedUserIds(scheduleId)
  const r = await addShift({ ...input, schedule_id: scheduleId })
  if (r.ok) {
    revalidatePath(`/modules/scheduling/manage/${weekStartDate}`)
    const current = await listScheduleAssignedUserIds(scheduleId)
    const { data: schedule } = await (await createClient())
      .from('schedules')
      .select('status, week_start_date')
      .eq('id', scheduleId)
      .maybeSingle()
    if (schedule?.status === 'published') {
      await notifyAffectedUsersAfterEdit(scheduleId, previous, current, schedule.week_start_date as string)
    }
  }
  return r
}

export async function updateShiftAction(scheduleId: string, weekStartDate: string, input: UpdateShiftInput) {
  const g = await gate()
  if (!g.ok) return g
  const r = await updateShift(input)
  if (r.ok) revalidatePath(`/modules/scheduling/manage/${weekStartDate}`)
  return r
}

export async function deleteShiftAction(scheduleId: string, weekStartDate: string, shiftId: string) {
  const g = await gate()
  if (!g.ok) return g
  const previous = await listScheduleAssignedUserIds(scheduleId)
  const r = await deleteShift(shiftId)
  if (r.ok) {
    revalidatePath(`/modules/scheduling/manage/${weekStartDate}`)
    const { data: schedule } = await (await createClient())
      .from('schedules')
      .select('status')
      .eq('id', scheduleId)
      .maybeSingle()
    if (schedule?.status === 'published') {
      const current = await listScheduleAssignedUserIds(scheduleId)
      await notifyAffectedUsersAfterEdit(scheduleId, previous, current, weekStartDate)
    }
  }
  return r
}

export async function assignUserAction(
  scheduleId: string,
  weekStartDate: string,
  shiftId: string,
  userId: string,
) {
  const g = await gate()
  if (!g.ok) return g
  const previous = await listScheduleAssignedUserIds(scheduleId)
  const r = await assignUserToShift(shiftId, userId)
  if (r.ok) {
    revalidatePath(`/modules/scheduling/manage/${weekStartDate}`)
    const { data: schedule } = await (await createClient())
      .from('schedules')
      .select('status')
      .eq('id', scheduleId)
      .maybeSingle()
    if (schedule?.status === 'published') {
      const current = await listScheduleAssignedUserIds(scheduleId)
      await notifyAffectedUsersAfterEdit(scheduleId, previous, current, weekStartDate)
    }
  }
  return r
}

export async function unassignUserAction(
  scheduleId: string,
  weekStartDate: string,
  shiftId: string,
  userId: string,
) {
  const g = await gate()
  if (!g.ok) return g
  const previous = await listScheduleAssignedUserIds(scheduleId)
  const r = await unassignUserFromShift(shiftId, userId)
  if (r.ok) {
    revalidatePath(`/modules/scheduling/manage/${weekStartDate}`)
    const { data: schedule } = await (await createClient())
      .from('schedules')
      .select('status')
      .eq('id', scheduleId)
      .maybeSingle()
    if (schedule?.status === 'published') {
      const current = await listScheduleAssignedUserIds(scheduleId)
      await notifyAffectedUsersAfterEdit(scheduleId, previous, current, weekStartDate)
    }
  }
  return r
}

export async function copyShiftsAction(
  scheduleId: string,
  weekStartDate: string,
  mode: CopyMode,
  includeAssignments: boolean,
  force: boolean,
) {
  const g = await gate()
  if (!g.ok) return g
  const r = await copyShifts({
    target_schedule_id: scheduleId,
    mode,
    include_assignments: includeAssignments,
    force,
  })
  if (r.ok) revalidatePath(`/modules/scheduling/manage/${weekStartDate}`)
  return r
}

export async function saveTemplateAction(blocks: TemplateBlockInput[]) {
  const g = await gate()
  if (!g.ok) return g
  const r = await replaceTemplate(blocks)
  if (r.ok) revalidatePath('/modules/scheduling/availability')
  return r
}

export async function saveOverridesAction(weekStartDate: string, blocks: TemplateBlockInput[]) {
  const g = await gate()
  if (!g.ok) return g
  const r = await replaceOverridesForWeek(weekStartDate, blocks)
  if (r.ok) revalidatePath('/modules/scheduling/availability')
  return r
}

export async function submitTimeOffAction(input: SubmitTimeOffInput) {
  const g = await gate()
  if (!g.ok) return g
  const r = await submitTimeOff(input)
  if (r.ok) revalidatePath('/modules/scheduling/time-off')
  return r
}

export async function decideTimeOffAction(
  requestId: string,
  decision: 'approved' | 'denied',
  note?: string,
) {
  const g = await gate()
  if (!g.ok) return g
  const r = await decideTimeOff({ request_id: requestId, decision, note })
  if (r.ok) {
    revalidatePath('/modules/scheduling/manage/time-off')
    revalidatePath('/modules/scheduling/time-off')
  }
  return r
}

export async function withdrawTimeOffAction(requestId: string) {
  const g = await gate()
  if (!g.ok) return g
  const r = await withdrawTimeOff(requestId)
  if (r.ok) revalidatePath('/modules/scheduling/time-off')
  return r
}

export async function proposeSwapAction(input: ProposeSwapInput) {
  const g = await gate()
  if (!g.ok) return g
  const r = await proposeSwap(input)
  if (r.ok) revalidatePath('/modules/scheduling/swaps')
  return r
}

export async function acceptSwapAction(swapId: string) {
  const g = await gate()
  if (!g.ok) return g
  const r = await acceptSwap(swapId)
  if (r.ok) {
    revalidatePath('/modules/scheduling/swaps')
    revalidatePath('/modules/scheduling/manage/swaps')
  }
  return r
}

export async function managerDecideSwapAction(
  swapId: string,
  decision: 'approved' | 'denied',
  note?: string,
) {
  const g = await gate()
  if (!g.ok) return g
  const r = await managerDecideSwap(swapId, decision, note)
  if (r.ok) revalidatePath('/modules/scheduling/manage/swaps')
  return r
}

export async function withdrawSwapAction(swapId: string) {
  const g = await gate()
  if (!g.ok) return g
  const r = await withdrawSwap(swapId)
  if (r.ok) revalidatePath('/modules/scheduling/swaps')
  return r
}
