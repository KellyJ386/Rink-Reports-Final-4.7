import { NextResponse } from 'next/server'

import { setImpersonationCookies } from '@/lib/auth/impersonation'
import { createClient } from '@/lib/supabase/server'
import { requirePlatformAdmin } from '@/lib/platform-admin/require'
import { logger } from '@/lib/observability/logger'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePlatformAdmin()
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  // Call the DB RPC — inserts impersonation_sessions row + audit_log
  const { error } = await supabase.rpc('rpc_start_impersonation', {
    p_target_facility_id: id,
  })
  if (error) {
    logger.error('impersonate.start_failed', { error: error.message, facility_id: id })
    return new NextResponse(error.message, { status: 400 })
  }

  await setImpersonationCookies({
    facility_id: id,
    platform_admin_id: user.id,
  })

  logger.info('impersonate.started', { facility_id: id, platform_admin_id: user.id })

  // Send them into the facility's admin shell
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin
  return NextResponse.redirect(`${appUrl}/admin`, 303)
}
