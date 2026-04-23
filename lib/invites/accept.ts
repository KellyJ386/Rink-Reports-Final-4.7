import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'
import { createClient as createSsrClient } from '@/lib/supabase/server'
import { consume } from '@/lib/rate-limit/limiter'

export type InviteLookupResult =
  | { state: 'valid'; invite_id: string; facility_id: string; facility_name: string; email: string; role_id: string; role_name: string }
  | { state: 'expired' }
  | { state: 'accepted' }
  | { state: 'revoked' }
  | { state: 'not_found' }

/**
 * Look up an invite by raw token. Used to render the accept-invite page with the
 * facility + role context.
 *
 * Rate-limited per client IP: 5 attempts per 15 minutes.
 */
export async function lookupInvite(rawToken: string, clientIp: string): Promise<InviteLookupResult> {
  if (!(await consume('accept-invite', clientIp))) {
    // Treat as not_found to avoid leaking whether the token exists. Caller renders
    // a 429 if they can distinguish, otherwise the generic "invalid" state.
    return { state: 'not_found' }
  }

  // We intentionally use the service client here because the endpoint is
  // unauthenticated. The RPC is SECURITY DEFINER and performs no privileged
  // side effects on its own — it just validates and returns state.
  const svc = createServiceClient()
  const { data, error } = await svc.rpc('rpc_lookup_invite_by_token', {
    p_raw_token: rawToken,
  })

  if (error) {
    console.error('lookupInvite RPC error', error)
    return { state: 'not_found' }
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row || row.state !== 'valid') {
    const badState = (row?.state ?? 'not_found') as 'expired' | 'accepted' | 'revoked' | 'not_found'
    // Build a discriminated union variant per state (TS can't narrow `{state: A|B}` to `{state: A}` downstream)
    switch (badState) {
      case 'expired':
        return { state: 'expired' }
      case 'accepted':
        return { state: 'accepted' }
      case 'revoked':
        return { state: 'revoked' }
      default:
        return { state: 'not_found' }
    }
  }

  return {
    state: 'valid',
    invite_id: row.invite_id,
    facility_id: row.facility_id,
    facility_name: row.facility_name,
    email: row.email,
    role_id: row.role_id,
    role_name: row.role_name,
  }
}

export type AcceptInviteInput = {
  rawToken: string
  password: string
  fullName: string
  clientIp: string
}

export type AcceptInviteResult =
  | { ok: true; facility_id: string }
  | { ok: false; reason: 'rate_limited' | 'invalid_token' | 'expired' | 'accepted' | 'revoked' | 'weak_password' | 'auth_create_failed' | 'db_error' }

/**
 * Accept an invite. Full flow:
 *   1. Rate-limit by IP
 *   2. Revalidate invite token + state (TOCTOU guard)
 *   3. Supabase Auth: admin.createUser with the invite's email + provided password
 *   4. SQL RPC: atomically insert users row, assign role, mark invite accepted, audit
 *
 * Runs entirely as service role. Never called from the browser directly — always via
 * a server action on /accept-invite.
 */
export async function acceptInvite(input: AcceptInviteInput): Promise<AcceptInviteResult> {
  const { rawToken, password, fullName, clientIp } = input

  if (!(await consume('accept-invite', clientIp))) {
    return { ok: false, reason: 'rate_limited' }
  }

  if (password.length < 12) {
    return { ok: false, reason: 'weak_password' }
  }

  const svc = createServiceClient()

  // Revalidate
  const { data: lookup, error: lookupError } = await svc.rpc('rpc_lookup_invite_by_token', {
    p_raw_token: rawToken,
  })
  if (lookupError) {
    console.error('acceptInvite lookup error', lookupError)
    return { ok: false, reason: 'invalid_token' }
  }
  const row = Array.isArray(lookup) ? lookup[0] : lookup
  if (!row || row.state === 'not_found') return { ok: false, reason: 'invalid_token' }
  if (row.state === 'expired') return { ok: false, reason: 'expired' }
  if (row.state === 'accepted') return { ok: false, reason: 'accepted' }
  if (row.state === 'revoked') return { ok: false, reason: 'revoked' }

  // Create auth user
  const { data: authCreated, error: authError } = await svc.auth.admin.createUser({
    email: row.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (authError || !authCreated.user) {
    console.error('acceptInvite auth.admin.createUser error', authError)
    return { ok: false, reason: 'auth_create_failed' }
  }

  // Atomic DB completion
  const { error: rpcError } = await svc.rpc('rpc_complete_invite_acceptance', {
    p_invite_id: row.invite_id,
    p_auth_user_id: authCreated.user.id,
    p_full_name: fullName,
  })

  if (rpcError) {
    // Best-effort cleanup of the orphaned auth user so the invite remains consumable.
    await svc.auth.admin.deleteUser(authCreated.user.id).catch(() => {})
    console.error('acceptInvite rpc_complete error', rpcError)
    return { ok: false, reason: 'db_error' }
  }

  return { ok: true, facility_id: row.facility_id }
}

/**
 * After acceptInvite returns ok, the caller can call this to sign the user in via
 * the SSR client and set the session cookie.
 */
export async function signInAfterAccept(email: string, password: string) {
  const ssr = await createSsrClient()
  const { error } = await ssr.auth.signInWithPassword({ email, password })
  if (error) throw error
}
