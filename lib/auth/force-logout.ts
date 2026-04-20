import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Force-logout a user.
 *
 * Finalized by Agent 7 per the contract originally shipped by Agent 6.
 * Callers should import from '@/lib/auth/force-logout' — this is the canonical
 * implementation for the entire product.
 *
 * Behavior contract:
 *
 *   1. Invalidates all active sessions for the target user via
 *      supabase.auth.admin.signOut(user_id, 'global'). Refresh tokens are revoked,
 *      not just the current access token.
 *
 *   2. Callable from server actions — pure async function; no browser-side state.
 *
 *   3. Writes audit_log:
 *        action        = 'user.force_logout'
 *        actor_user_id = caller
 *        entity_type   = 'user'
 *        entity_id     = target user_id
 *        metadata      = { reason } when provided
 *      If an impersonation session is active, the audit_log BEFORE INSERT trigger
 *      auto-populates actor_impersonator_id.
 *
 *   4. Sets public.users.active = false before invalidating sessions, so
 *      middleware blocks any in-flight request on its next hop even if
 *      admin.signOut is delayed or fails partway through.
 *
 *   5. Returns { ok: true } | { ok: false; error }.
 *
 *   6. Does NOT depend on a distributed session registry. If session invalidation
 *      fails, we return the failure to the caller but leave active=false in place
 *      (so middleware still blocks on next hop). The recovery path is to retry.
 *
 *   7. AuthZ is the caller's responsibility. This function assumes the caller has
 *      already verified their authority (e.g. via requireAdminControlCenterAdmin()
 *      for facility admins, or requirePlatformAdmin() for platform admins).
 */

export type ForceLogoutInput = {
  user_id: string
  /** Optional human-readable reason recorded in audit_log.metadata. */
  reason?: string
}

export type ForceLogoutResult = { ok: true } | { ok: false; error: string }

export async function forceLogoutUser(input: ForceLogoutInput): Promise<ForceLogoutResult> {
  const supabase = await createClient()

  const {
    data: { user: actor },
    error: actorError,
  } = await supabase.auth.getUser()
  if (actorError || !actor) return { ok: false, error: 'Not authenticated' }

  const { data: target, error: targetError } = await supabase
    .from('users')
    .select('facility_id')
    .eq('id', input.user_id)
    .maybeSingle()
  if (targetError) return { ok: false, error: targetError.message }
  if (!target) return { ok: false, error: 'Target user not found' }

  // 1. active = false first, so middleware blocks in-flight requests immediately
  const { error: deactivateError } = await supabase
    .from('users')
    .update({ active: false })
    .eq('id', input.user_id)
  if (deactivateError) {
    return { ok: false, error: `Deactivation failed: ${deactivateError.message}` }
  }

  // 2. Invalidate all sessions globally (service role required for auth admin API)
  const svc = createServiceClient()
  const { error: signOutError } = await svc.auth.admin.signOut(input.user_id, 'global')
  if (signOutError) {
    console.error('forceLogoutUser: global signOut failed', signOutError)
    return {
      ok: false,
      error: `User deactivated but session invalidation failed: ${signOutError.message}. Retry the action to complete.`,
    }
  }

  // 3. Audit — trigger auto-populates actor_impersonator_id if applicable
  const { error: auditError } = await supabase.from('audit_log').insert({
    facility_id: target.facility_id,
    actor_user_id: actor.id,
    action: 'user.force_logout',
    entity_type: 'user',
    entity_id: input.user_id,
    metadata: input.reason ? { reason: input.reason } : {},
  })
  if (auditError) {
    console.error('forceLogoutUser: audit write failed', auditError)
    // Non-fatal — the core operation succeeded
  }

  return { ok: true }
}
