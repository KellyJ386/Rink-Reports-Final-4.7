import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createHash, randomBytes } from 'node:crypto'

export type CreateInviteInput = {
  email: string
  roleId: string
}

export type CreateInviteResult = {
  invite_id: string
  invite_url: string
}

/**
 * Facility-admin-only. Creates an invite for the caller's current facility.
 * facility_id is sourced from current_facility_id() on the server — never accepted
 * from the client.
 *
 * This flow does NOT use the create-facility RPC; it's a straight INSERT gated by
 * facility_invites' RLS (admin access on admin_control_center in current facility).
 *
 * Returns the raw invite URL for the admin UI to display / copy to clipboard.
 */
export async function createInvite(input: CreateInviteInput): Promise<CreateInviteResult> {
  const supabase = await createClient()

  // Current user id (for invited_by). If unauthenticated, RLS will reject.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('createInvite: not authenticated')

  // Generate token
  const rawToken = base64url(randomBytes(32))
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  // Resolve the role's facility_id to include in the insert (the RLS WITH CHECK +
  // facility-match trigger will verify; we set it explicitly to satisfy both).
  //
  // We use the authenticated client so RLS on roles enforces the caller can only see
  // their own facility's roles. A forged roleId from another facility returns null
  // under RLS and we reject.
  const { data: role, error: roleError } = await supabase
    .from('roles')
    .select('id, facility_id')
    .eq('id', input.roleId)
    .maybeSingle()

  if (roleError) throw new Error(`createInvite: role lookup failed: ${roleError.message}`)
  if (!role) throw new Error('createInvite: role not found or not accessible')

  // The DEFAULT current_facility_id() would also work, but being explicit makes the
  // WITH CHECK predicate on facility_invites_insert trivially satisfied and keeps
  // intent readable.
  const { data: inserted, error: insertError } = await supabase
    .from('facility_invites')
    .insert({
      facility_id: role.facility_id,
      email: input.email,
      role_id: input.roleId,
      invited_by: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    })
    .select('id')
    .single()

  if (insertError) throw new Error(`createInvite: ${insertError.message}`)

  // Audit via service client (keeps audit write separate from user-visible errors)
  void createServiceClient()
    .from('audit_log')
    .insert({
      facility_id: role.facility_id,
      actor_user_id: user.id,
      action: 'invite.created',
      entity_type: 'invite',
      entity_id: inserted.id,
      metadata: { email: input.email, role_id: input.roleId },
    })
    .then(({ error }) => {
      if (error) console.error('createInvite: audit write failed', error)
    })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.rinkreports.com'

  return {
    invite_id: inserted.id,
    invite_url: `${appUrl}/accept-invite?token=${encodeURIComponent(rawToken)}`,
  }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
