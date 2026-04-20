import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createCheckoutSession } from '@/lib/billing/checkout'
import { requireAdminControlCenterAdmin } from '@/lib/admin/require-admin'

const Body = z.object({
  tier: z.enum(['single_facility_monthly', 'single_facility_annual']),
})

export async function POST(request: Request) {
  // Must be a facility admin
  await requireAdminControlCenterAdmin()

  let body: z.infer<typeof Body>
  try {
    body = Body.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const result = await createCheckoutSession({ tier: body.tier })
  if (!result.ok) {
    const status = result.reason === 'stripe_not_configured' ? 503 : 500
    return NextResponse.json({ error: result.reason, detail: result.error ?? null }, { status })
  }
  return NextResponse.json({ url: result.url })
}
