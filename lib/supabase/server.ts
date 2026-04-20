import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

const IMP_FACILITY_COOKIE = 'impersonation_facility_id'
const IMP_ADMIN_COOKIE = 'impersonation_platform_admin_id'
const IMP_HEARTBEAT_COOKIE = 'impersonation_last_seen'

/**
 * Create a Supabase server client bound to the current request's cookies.
 *
 * If platform-admin impersonation cookies are present AND valid, this helper
 * also invokes rpc_set_request_vars to set Postgres session variables that
 * current_facility_id() honors. This means every RSC / server action that
 * creates a client gets impersonation for free — no per-caller plumbing.
 *
 * rpc_set_request_vars verifies the caller is a platform admin, so a forged
 * cookie from a non-admin gets a silent noop.
 */
export async function createClient() {
  const cookieStore = await cookies()

  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(
          cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>,
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // setAll called from a Server Component — safe to ignore; middleware refreshes session.
          }
        },
      },
    },
  )

  // Auto-apply impersonation session vars when cookies are present
  const impFacility = cookieStore.get(IMP_FACILITY_COOKIE)?.value
  const impAdmin = cookieStore.get(IMP_ADMIN_COOKIE)?.value
  const impHeartbeat = cookieStore.get(IMP_HEARTBEAT_COOKIE)?.value

  if (impFacility && impAdmin && impHeartbeat) {
    // Fire-and-forget: the RPC is idempotent and silently noops for non-platform-admins.
    // Errors are logged but don't block the request.
    void client
      .rpc('rpc_set_request_vars', {
        p_impersonated_facility_id: impFacility,
        p_impersonator_user_id: impAdmin,
      })
      .then(({ error }) => {
        if (error) {
          console.warn('createClient: rpc_set_request_vars failed', error.message)
        }
      })
  }

  return client
}
