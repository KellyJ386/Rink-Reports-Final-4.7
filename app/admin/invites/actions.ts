'use server'

import { createInvite, type CreateInviteInput } from '@/lib/invites/create'
import { resendInvite } from '@/lib/invites/resend'
import { revokeInvite } from '@/lib/invites/revoke'

export async function createInviteAction(input: CreateInviteInput) {
  return createInvite(input)
}

export async function revokeInviteAction(inviteId: string) {
  await revokeInvite(inviteId)
  return { ok: true as const }
}

export async function resendInviteAction(inviteId: string) {
  return resendInvite(inviteId)
}
