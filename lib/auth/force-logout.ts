import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * ForceLogoutUser contract (shared interface)
 * ==========================================
 *
 * Agent 6 ships the inline implementation below. Agent 7 replaces it by rewriting
 * THIS file (same exports, same behavior). No other module imports a replacement —
 * all callers import from '@/lib/auth/force-logout' — so the Agent 7 swap is a
 * file change, not an import refactor.
 *
 * TODO(agent-7): replace the inline implementation below with the canonical one.
 *
 * Acceptance criteria Agent 7's implementation must satisfy:
 *
 *   1. Must invalidate all active sessions for the target user — not just expire
 *      the current access token. Refresh tokens must be revoked. Supabase Auth's
 *      admin API `admin.signOut(user_id, { scope: 'global' })` satisfies this.
 *
 *   2. Must be callable from server actions — no browser-side state, no hooks, no
 *      React context. Pure async function with the signature exported here.
 *
 *   3. Must be auditable. Writes an audit_log row with:
 *        action        = 'user.force_logout'
 *        actor_user_id = caller (the admin performing the action)
 *        entity_type   = 'user'
 *        entity_id     = target user_id
 *        metadata      = { reason?: string } when provided
 *
 *   4. Must set public.users.active = false in the same logical operation as the
 *      auth invalidation, so middleware blocks any in-flight sessions on their
 *      next request. Order: flip `active` → call admin.signOut → audit_log.
 *      (If admin.signOut fails mid-flight, `active = false` still blocks access
 *      at the middleware; the recovery path is to retry admin.signOut.)
 *
 *   5. Must return `{ ok: true }` on success or `{ ok: false; error: string }` on
 *      failure with an admin-readable message (no raw Supabase errors leaked).
 *
 *   6. Must NOT depend on a network session registry (Redis / Upstash) in v1. If
 *      Agent 7 later needs distributed session invalidation, they extend this
 *      contract with an opt-in mechanism; the v1 interface stays stable.
 *
 *   7. AuthZ is the caller's responsibility: this function assumes the caller has
 *      already verified their authority to deactivate the target user (e.g., via
 *      requireAdminControlCenterAdmin()). This function does NOT re-check.
 */

export type ForceLogoutInput = {
  user_id: string
  /** Optional human-readable reason surfaced in audit_log.metadata. */
  reason?: string
}

export type ForceLogoutResult = { ok: true } | { ok: false; error: string }

export async function forceLogoutUser(input: ForceLogoutInput): Promise<ForceLogoutResult> {
  const supabase = await createClient()

  // Resolve the caller (for audit_log.actor_user_id)
  const {
    data: { user: actor },
    error: actorError,
  } = await supabase.auth.getUser()
  if (actorError || !actor) {
    return { ok: false, error: 'Not authenticated' }
  }

  // Resolve the target's facility (for audit_log.facility_id)
  const { data: target, error: targetError } = await supabase
    .from('users')
    .select('facility_id')
    .eq('id', input.user_id)
    .maybeSingle()
  if (targetError) return { ok: false, error: targetError.message }
  if (!target) return { ok: false, error: 'Target user not found' }

  // 1. Flip active = false (RLS: caller must be facility admin; trigger blocks cross-facility)
  const { error: deactivateError } = await supabase
    .from('users')
    .update({ active: false })
    .eq('id', input.user_id)
  if (deactivateError) {
    return { ok: false, error: `Failed to deactivate user: ${deactivateError.message}` }
  }

  // 2. Invalidate all Supabase sessions for the user (global scope = revoke refresh tokens)
  const svc = createServiceClient()
  const { error: signOutError } = await svc.auth.admin.signOut(input.user_id, 'global')
  if (signOutError) {
    // Non-fatal: middleware still rejects the user on their next request because
    // active=false. But surface the error so the admin knows to retry.
    console.error('forceLogoutUser: admin.signOut failed', signOutError)
    return {
      ok: false,
      error: `User deactivated but session invalidation failed: ${signOutError.message}. Retry to complete.`,
    }
  }

  // 3. Audit
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
    // Still return ok — the core operation succeeded.
  }

  return { ok: true }
}
