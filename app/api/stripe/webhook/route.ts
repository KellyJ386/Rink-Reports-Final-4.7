import { NextResponse } from 'next/server'
import type Stripe from 'stripe'

import { applyStripeEvent } from '@/lib/billing/apply-webhook'
import { getStripe } from '@/lib/billing/stripe'
import { createServiceClient } from '@/lib/supabase/service'
import { logger } from '@/lib/observability/logger'
import { captureException } from '@/lib/observability/sentry'

/**
 * Stripe webhook endpoint.
 *
 * Invariants:
 *   - Signature verification via stripe.webhooks.constructEvent + STRIPE_WEBHOOK_SECRET
 *   - Every event lands in billing_events with a unique stripe_event_id constraint
 *     (replays are no-ops)
 *   - We return 200 ONLY after the event is recorded; Stripe retries otherwise
 *   - Event application errors don't fail the webhook — we store error_if_any and
 *     return 200. The stripe-webhook-retry scheduled job picks them up later.
 *
 * This route is excluded from auth middleware (matcher in middleware.ts).
 */

export async function POST(request: Request) {
  const stripe = getStripe()
  if (!stripe) {
    logger.warn('stripe.webhook.skipped', { outcome: 'error', error: 'stripe_not_configured' })
    return new NextResponse('Stripe not configured', { status: 503 })
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    return new NextResponse('Webhook secret not configured', { status: 503 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) return new NextResponse('Missing stripe-signature', { status: 400 })

  const raw = await request.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, signature, webhookSecret)
  } catch (err) {
    logger.warn('stripe.webhook.verify_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return new NextResponse('Invalid signature', { status: 400 })
  }

  const svc = createServiceClient()

  // 1. Record the event (idempotent via unique stripe_event_id). If this INSERT
  //    hits a unique-violation, it's a replay — we've already processed it.
  const { error: insertError } = await svc.from('billing_events').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    payload: event as unknown as Record<string, unknown>,
    processed_at: null,
  })

  if (insertError && insertError.code !== '23505') {
    logger.error('stripe.webhook.persist_failed', { error: insertError.message })
    captureException(insertError, { action: 'stripe.webhook' })
    return new NextResponse('Failed to persist event', { status: 500 })
  }

  // 2. Apply side effects
  const apply = await applyStripeEvent(event)

  // 3. Mark processed OR record the error for retry
  if (apply.ok) {
    await svc
      .from('billing_events')
      .update({ processed_at: new Date().toISOString(), error_if_any: null })
      .eq('stripe_event_id', event.id)
    logger.info('stripe.webhook.applied', {
      action: 'stripe.webhook',
      outcome: 'ok',
      event_type: event.type,
      handled: apply.handled,
    })
  } else {
    await svc
      .from('billing_events')
      .update({ error_if_any: apply.error })
      .eq('stripe_event_id', event.id)
    logger.warn('stripe.webhook.apply_failed', {
      action: 'stripe.webhook',
      outcome: 'error',
      event_type: event.type,
      error: apply.error,
    })
    captureException(new Error(apply.error), {
      action: 'stripe.webhook',
      extra: { event_id: event.id, event_type: event.type },
    })
  }

  return NextResponse.json({ received: true })
}
