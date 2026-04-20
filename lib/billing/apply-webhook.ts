import 'server-only'

import type Stripe from 'stripe'

import { createServiceClient } from '@/lib/supabase/service'
import { publishNotification } from '@/lib/notifications/publish'

/**
 * Apply a Stripe webhook event to facility_subscriptions. Idempotent: called
 * either by the /api/stripe/webhook handler (once per receipt) or by the
 * stripe-webhook-retry scheduled job (once per failed replay).
 *
 * Handled event types:
 *   checkout.session.completed     → link customer + subscription to facility
 *   customer.subscription.updated  → sync status / plan_tier / current_period_end
 *   customer.subscription.deleted  → mark canceled
 *   invoice.payment_failed         → mark past_due if subscription says so
 *
 * Every other event type is ignored (but still acknowledged in billing_events
 * with processed_at set, so we don't retry them forever).
 */

export type ApplyResult =
  | { ok: true; handled: boolean }
  | { ok: false; error: string }

export async function applyStripeEvent(event: Stripe.Event): Promise<ApplyResult> {
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        return await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
        return await handleSubscriptionSynced(event.data.object as Stripe.Subscription)
      case 'customer.subscription.deleted':
        return await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
      case 'invoice.payment_failed':
        return await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
      default:
        // Unhandled types are acknowledged; no-op.
        return { ok: true, handled: false }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<ApplyResult> {
  const svc = createServiceClient()
  const facilityId = (session.metadata?.facility_id ?? session.client_reference_id) as string | null
  if (!facilityId) return { ok: false, error: 'checkout.session.completed missing facility_id' }

  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id
  const subscriptionId =
    typeof session.subscription === 'string' ? session.subscription : session.subscription?.id

  const patch: Record<string, unknown> = {
    stripe_customer_id: customerId ?? null,
    stripe_subscription_id: subscriptionId ?? null,
    status: 'active',
  }

  const { error } = await svc
    .from('facility_subscriptions')
    .update(patch)
    .eq('facility_id', facilityId)

  if (error) return { ok: false, error: error.message }
  return { ok: true, handled: true }
}

async function handleSubscriptionSynced(sub: Stripe.Subscription): Promise<ApplyResult> {
  const svc = createServiceClient()
  const facilityId = (sub.metadata?.facility_id as string | undefined) ?? null

  const currentPeriodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null

  const patch: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    status: mapStatus(sub.status),
    current_period_end: currentPeriodEnd,
  }

  // Prefer facility_id from metadata; fall back to existing row matching subscription id
  const query = facilityId
    ? svc.from('facility_subscriptions').update(patch).eq('facility_id', facilityId)
    : svc.from('facility_subscriptions').update(patch).eq('stripe_subscription_id', sub.id)

  const { error } = await query
  if (error) return { ok: false, error: error.message }
  return { ok: true, handled: true }
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<ApplyResult> {
  const svc = createServiceClient()
  const { error } = await svc
    .from('facility_subscriptions')
    .update({ status: 'canceled' })
    .eq('stripe_subscription_id', sub.id)
  if (error) return { ok: false, error: error.message }
  return { ok: true, handled: true }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<ApplyResult> {
  const svc = createServiceClient()
  const subId =
    typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
  if (!subId) return { ok: true, handled: false }

  // Load subscription row to get facility + admin user for the email
  const { data: sub } = await svc
    .from('facility_subscriptions')
    .select('facility_id')
    .eq('stripe_subscription_id', subId)
    .maybeSingle()

  const { error } = await svc
    .from('facility_subscriptions')
    .update({ status: 'past_due' })
    .eq('stripe_subscription_id', subId)
  if (error) return { ok: false, error: error.message }

  if (sub?.facility_id) {
    // Notify the facility's admins (best-effort; non-fatal)
    const { data: admins } = await svc
      .from('user_roles')
      .select('user_id, roles!inner(name, facility_id)')
      .eq('roles.facility_id', sub.facility_id)
      .eq('roles.name', 'Admin')

    for (const row of (admins ?? []) as Array<{ user_id: string }>) {
      await publishNotification({
        user_id: row.user_id,
        kind: 'subscription.past_due',
        payload: { day: 1, current_period_end: null },
      }).catch(() => {})
    }
  }

  return { ok: true, handled: true }
}

function mapStatus(stripeStatus: Stripe.Subscription.Status): 'trialing' | 'active' | 'past_due' | 'canceled' {
  switch (stripeStatus) {
    case 'trialing':
      return 'trialing'
    case 'active':
      return 'active'
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
    case 'incomplete_expired':
      return 'past_due'
    case 'canceled':
    case 'paused':
      return 'canceled'
    default:
      return 'past_due'
  }
}
