import { NextResponse } from 'next/server'

import { clearImpersonationCookies } from '@/lib/auth/impersonation'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/observability/logger'

export async function POST(request: Request) {
  const supabase = await createClient()
  // Close the active session in DB (RPC checks platform-admin privilege; silent
  // noop if not active). No requirePlatformAdmin at the route level because
  // clearing the cookie should work even if privilege was revoked mid-session.
  await supabase.rpc('rpc_stop_impersonation').catch(() => undefined)
  await clearImpersonationCookies()
  logger.info('impersonate.stopped')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin
  return NextResponse.redirect(`${appUrl}/platform-admin`, 303)
}
