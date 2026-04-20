import { NextResponse } from 'next/server'

import { logScheduledJobRun } from '@/lib/scheduled-jobs/run-logger'
import { verifyQstashRequest } from '@/lib/scheduled-jobs/verify-qstash'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Scheduled daily: flip trialing → past_due for facilities whose trial_end has
 * passed AND that never added a Stripe subscription.
 *
 * Idempotent: only affects rows where status = 'trialing' AND trial_end < now()
 * AND stripe_subscription_id IS NULL.
 */
export async function POST(request: Request) {
  const verified = await verifyQstashRequest(request)
  if (!verified.ok) return new NextResponse(verified.error, { status: 401 })

  const outcome = await logScheduledJobRun('trial-expiration-check', async (ctx) => {
    const svc = createServiceClient()
    const { data, error } = await svc
      .from('facility_subscriptions')
      .update({ status: 'past_due' })
      .eq('status', 'trialing')
      .lt('trial_end', new Date().toISOString())
      .is('stripe_subscription_id', null)
      .select('facility_id')

    if (error) throw new Error(error.message)

    const flipped = (data ?? []).length
    ctx.bumpProcessed(flipped)
    ctx.bumpSucceeded(flipped)
    return { flipped }
  })

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error, run_id: outcome.run_id }, { status: 500 })
  }
  return NextResponse.json({ ok: true, run_id: outcome.run_id, ...outcome.result })
}
