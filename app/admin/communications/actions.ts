'use server'

import { revalidatePath } from 'next/cache'

import { setSetting } from '@/lib/facility/settings'

export async function saveRequireAckAction(enabled: boolean) {
  const r = await setSetting('communications.require_ack_enabled', enabled)
  if (r.ok) revalidatePath('/admin/communications')
  return r
}

export async function saveDefaultExpiryDaysAction(days: number) {
  const r = await setSetting('communications.default_expiry_days', days)
  if (r.ok) revalidatePath('/admin/communications')
  return r
}
