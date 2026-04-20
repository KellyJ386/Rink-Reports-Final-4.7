import { NextResponse } from 'next/server'
import type Stripe from 'stripe'

import { applyStripeEvent } from '@/lib/billing/apply-webhook'
import { logScheduledJobRun } from '@/lib/scheduled-jobs/run-logger'
import { verifyQstashRequest } from '@/lib/scheduled-jobs/verify-qstash'
import { createServiceClient } from '@/lib/supabase/service'
import { captureException } from '@/lib/observability/sentry'

/**
 * Hourly: replay any billing_events rows with error_if_any set and
 * processed_at null. Safe because applyStripeEvent is idempotent.
 */
export async function POST(request: Request) {
  const verified = await verifyQstashRequest(request)
  if (!verified.ok) return new NextResponse(verified.error, { status: 401 })

  const outcome = await logScheduledJobRun('stripe-webhook-retry', async (ctx) => {
    const svc = createServiceClient()

    const { data: rows } = await svc
      .from('billing_events')
      .select('stripe_event_id, event_type, payload, error_if_any')
      .is('processed_at', null)
      .not('error_if_any', 'is', null)
      .order('created_at', { ascending: true })
      .limit(100)

    let succeeded = 0
    let failed = 0

    for (const row of (rows ?? []) as Array<{
      stripe_event_id: string
      event_type: string
      payload: Stripe.Event
      error_if_any: string | null
    }>) {
      ctx.bumpProcessed()
      const result = await applyStripeEvent(row.payload)
      if (result.ok) {
        await svc
          .from('billing_events')
          .update({ processed_at: new Date().toISOString(), error_if_any: null })
          .eq('stripe_event_id', row.stripe_event_id)
        succeeded++
        ctx.bumpSucceeded()
      } else {
        await svc
          .from('billing_events')
          .update({ error_if_any: result.error })
          .eq('stripe_event_id', row.stripe_event_id)
        failed++
        ctx.bumpFailed()
        captureException(new Error(result.error), {
          action: 'stripe.webhook_retry',
          extra: { stripe_event_id: row.stripe_event_id, event_type: row.event_type },
        })
      }
    }

    return { succeeded, failed }
  })

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error, run_id: outcome.run_id }, { status: 500 })
  }
  return NextResponse.json({ ok: true, run_id: outcome.run_id, ...outcome.result })
}
