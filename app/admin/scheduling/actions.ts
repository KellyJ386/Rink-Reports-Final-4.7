'use server'

import { revalidatePath } from 'next/cache'

import { setSetting } from '@/lib/facility/settings'

export async function saveCutoffDaysAction(days: number) {
  const r = await setSetting('scheduling.availability_cutoff_days', days)
  if (r.ok) revalidatePath('/admin/scheduling')
  return r
}

export async function saveSwapApprovalModeAction(mode: 'manager_approval' | 'free') {
  const r = await setSetting('scheduling.swap_approval_mode', mode)
  if (r.ok) revalidatePath('/admin/scheduling')
  return r
}
