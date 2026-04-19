import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Revoke an outstanding invite. Idempotent: re-revoking is a no-op. Rejects if the
 * invite has already been accepted.
 *
 * AuthZ (enforced in SQL): platform admin OR facility admin for the invite's facility.
 */
export async function revokeInvite(inviteId: string): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase.rpc('rpc_revoke_invite', {
    p_invite_id: inviteId,
  })

  if (error) {
    throw new Error(`revokeInvite: ${error.message}`)
  }
}
