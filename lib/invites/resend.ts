import 'server-only'

import { createHash, randomBytes } from 'node:crypto'

import { createClient } from '@/lib/supabase/server'

/**
 * Resend an invite. Generates a fresh token + hash, updates the row,
 * and extends the expiry. Fails if the invite was already accepted or revoked.
 *
 * Returns the raw token URL for the admin UI to copy.
 */
export async function resendInvite(
  inviteId: string,
): Promise<{ ok: true; invite_url: string } | { ok: false; error: string }> {
  const supabase = await createClient()

  const { data: invite, error: loadError } = await supabase
    .from('facility_invites')
    .select('id, accepted_at, revoked_at')
    .eq('id', inviteId)
    .maybeSingle()
  if (loadError) return { ok: false, error: loadError.message }
  if (!invite) return { ok: false, error: 'Invite not found' }
  if (invite.accepted_at) return { ok: false, error: 'Invite already accepted' }
  if (invite.revoked_at) return { ok: false, error: 'Invite was revoked — create a new one' }

  const rawToken = base64url(randomBytes(32))
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await supabase
    .from('facility_invites')
    .update({ token_hash: tokenHash, expires_at: expiresAt })
    .eq('id', inviteId)
  if (error) return { ok: false, error: error.message }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  await supabase.from('audit_log').insert({
    actor_user_id: user?.id ?? null,
    action: 'invite.resent',
    entity_type: 'invite',
    entity_id: inviteId,
    metadata: {},
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.rinkreports.com'
  return { ok: true, invite_url: `${appUrl}/accept-invite?token=${encodeURIComponent(rawToken)}` }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
