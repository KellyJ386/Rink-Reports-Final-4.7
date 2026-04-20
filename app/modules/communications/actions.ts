'use server'

import { revalidatePath } from 'next/cache'

import { postAnnouncement } from '@/lib/communications/post'
import { acknowledgeAnnouncement } from '@/lib/communications/read'
import { archiveAnnouncement } from '@/lib/communications/archive'
import { requireActiveSubscription } from '@/lib/billing/require-active-subscription'
import type { PostAnnouncementInput, PostAnnouncementResult } from '@/lib/communications/types'

export async function postAnnouncementAction(
  input: PostAnnouncementInput,
): Promise<PostAnnouncementResult> {
  const gate = await requireActiveSubscription()
  if (!gate.ok) return { ok: false, error: `subscription_${gate.reason}` }

  const res = await postAnnouncement(input)
  if (res.ok) {
    revalidatePath('/modules/communications')
  }
  return res
}

export async function acknowledgeAction(announcementId: string) {
  // No subscription gate on acknowledgments — read path continues during grace.
  const res = await acknowledgeAnnouncement(announcementId)
  if (res.ok) {
    revalidatePath(`/modules/communications/${announcementId}`)
    revalidatePath('/modules/communications')
  }
  return res
}

export async function archiveAction(announcementId: string) {
  const gate = await requireActiveSubscription()
  if (!gate.ok) return { ok: false, error: `subscription_${gate.reason}` }

  const res = await archiveAnnouncement(announcementId)
  if (res.ok) {
    revalidatePath(`/modules/communications/${announcementId}`)
    revalidatePath('/modules/communications')
  }
  return res
}
