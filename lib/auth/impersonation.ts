import 'server-only'

import { cookies } from 'next/headers'

import { createClient } from '@/lib/supabase/server'

/**
 * Impersonation cookie management + per-request DB session-var application.
 *
 * Cookies set by /platform-admin/facilities/[id]/impersonate (POST):
 *   - impersonation_facility_id  (uuid, plain string)
 *   - impersonation_platform_admin_id (uuid, plain string; == the user setting the cookie)
 *
 * Both are httpOnly + Secure (in production) + SameSite=Strict. No JWT signing:
 * the cookies are trust-checked inside rpc_set_request_vars by requiring the
 * caller be a platform admin. A non-platform-admin presenting a forged cookie
 * gets a silent noop from the RPC.
 *
 * Idle timeout: 2 hours since last request. Enforced by storing a last-seen
 * cookie whose expiration is 2h sliding. If it's gone on the next request, we
 * clear the impersonation cookies too.
 */

const IMP_FACILITY_COOKIE = 'impersonation_facility_id'
const IMP_ADMIN_COOKIE = 'impersonation_platform_admin_id'
const IMP_HEARTBEAT_COOKIE = 'impersonation_last_seen'
const IDLE_TIMEOUT_SECONDS = 2 * 60 * 60

export async function readImpersonationCookies(): Promise<
  { facility_id: string; platform_admin_id: string } | null
> {
  const store = await cookies()
  const facilityId = store.get(IMP_FACILITY_COOKIE)?.value
  const adminId = store.get(IMP_ADMIN_COOKIE)?.value
  const heartbeat = store.get(IMP_HEARTBEAT_COOKIE)?.value

  if (!facilityId || !adminId) return null
  if (!heartbeat) {
    // Heartbeat expired → idle timeout. Caller should clear via
    // clearImpersonationCookies() next chance.
    return null
  }
  return { facility_id: facilityId, platform_admin_id: adminId }
}

export async function setImpersonationCookies(opts: {
  facility_id: string
  platform_admin_id: string
}): Promise<void> {
  const store = await cookies()
  const secure = process.env.NODE_ENV === 'production'
  const common = {
    httpOnly: true,
    secure,
    sameSite: 'strict' as const,
    path: '/',
  }
  store.set(IMP_FACILITY_COOKIE, opts.facility_id, common)
  store.set(IMP_ADMIN_COOKIE, opts.platform_admin_id, common)
  store.set(IMP_HEARTBEAT_COOKIE, String(Date.now()), {
    ...common,
    maxAge: IDLE_TIMEOUT_SECONDS,
  })
}

export async function refreshImpersonationHeartbeat(): Promise<void> {
  const store = await cookies()
  if (!store.get(IMP_FACILITY_COOKIE)) return
  const secure = process.env.NODE_ENV === 'production'
  store.set(IMP_HEARTBEAT_COOKIE, String(Date.now()), {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: IDLE_TIMEOUT_SECONDS,
  })
}

export async function clearImpersonationCookies(): Promise<void> {
  const store = await cookies()
  for (const name of [IMP_FACILITY_COOKIE, IMP_ADMIN_COOKIE, IMP_HEARTBEAT_COOKIE]) {
    store.delete(name)
  }
}

/**
 * Apply the impersonation DB session variables for this request's Supabase
 * connection. Call this once per authenticated request BEFORE any query that
 * depends on current_facility_id() or audit_log trigger behavior.
 *
 * Noop if the caller has no cookies. Silent-noop at the DB level if the caller
 * isn't actually a platform admin (handled inside rpc_set_request_vars).
 */
export async function applyImpersonationSessionVar(): Promise<void> {
  const imp = await readImpersonationCookies()
  if (!imp) return

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  // Cookie claims a particular impersonator; must match the current session
  if (user.id !== imp.platform_admin_id) return

  // Also refresh the idle-timeout heartbeat
  await refreshImpersonationHeartbeat()

  const { error } = await supabase.rpc('rpc_set_request_vars', {
    p_impersonated_facility_id: imp.facility_id,
    p_impersonator_user_id: imp.platform_admin_id,
  })
  if (error) {
    console.warn('applyImpersonationSessionVar: rpc_set_request_vars failed', error.message)
  }
}
