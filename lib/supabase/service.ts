import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client. Bypasses RLS.
 *
 * Use ONLY from trusted server-side code paths:
 *   - Platform-admin bootstrap (`createFacilityWithFirstAdmin`)
 *   - Accept-invite flow (the user doesn't exist yet when their profile row is written)
 *   - Agent 7's Stripe webhook handlers
 *   - Agent 7's `forceLogoutUser`
 *
 * NEVER expose the service role key to the client. The `server-only` import at the
 * top of this file will blow up the build if this module is imported in a client
 * component.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  return createSupabaseClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
