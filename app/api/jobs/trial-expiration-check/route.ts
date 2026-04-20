import { NextResponse } from 'next/server'

import { verifyQstashRequest } from '@/lib/scheduled-jobs/verify-qstash'
import { createServiceClient } from '@/lib/supabase/service'
import { logger } from '@/lib/observability/logger'

/**
 * Scheduled daily: flip trialing → past_due for facilities whose trial_end has
 * passed AND that never added a Stripe subscription.
 *
 * Idempotent: only affects rows where status = 'trialing' AND trial_end < now()
 * AND stripe_subscription_id IS NULL. Running it multiple times in the same day
 * changes nothing on already-flipped rows.
 */
export async function POST(request: Request) {
  const verified = await verifyQstashRequest(request)
  if (!verified.ok) return new NextResponse(verified.error, { status: 401 })

  const svc = createServiceClient()
  const { data, error } = await svc
    .from('facility_subscriptions')
    .update({ status: 'past_due' })
    .eq('status', 'trialing')
    .lt('trial_end', new Date().toISOString())
    .is('stripe_subscription_id', null)
    .select('facility_id')

  if (error) {
    logger.error('job.trial_expiration_check.failed', { error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  logger.info('job.trial_expiration_check.ok', { flipped: (data ?? []).length })
  return NextResponse.json({ ok: true, flipped: (data ?? []).length })
}
