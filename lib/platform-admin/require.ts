import 'server-only'

import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

/**
 * Gate for every /platform-admin/* route. Verifies is_platform_admin() returns
 * true for the current session. Failure → 404 (not 401) to hide the surface
 * from non-admins.
 *
 * Does NOT depend on impersonation state — platform admins can reach
 * /platform-admin/* regardless of whether they're currently impersonating a
 * facility. (In practice, platform-admin routes explicitly clear any active
 * impersonation session var so queries on this shell don't scope.)
 */
export async function requirePlatformAdmin(): Promise<void> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('is_platform_admin')
  if (error) {
    console.error('requirePlatformAdmin: RPC error', error)
    notFound()
  }
  if (!data) notFound()
}
