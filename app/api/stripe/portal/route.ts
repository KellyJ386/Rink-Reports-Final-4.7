import { NextResponse } from 'next/server'

import { openBillingPortal } from '@/lib/billing/portal'
import { requireAdminControlCenterAdmin } from '@/lib/admin/require-admin'

export async function POST() {
  await requireAdminControlCenterAdmin()
  const result = await openBillingPortal()
  if (!result.ok) {
    const status = result.reason === 'stripe_not_configured' ? 503 : 500
    return NextResponse.json({ error: result.reason, detail: result.error ?? null }, { status })
  }
  return NextResponse.json({ url: result.url })
}
