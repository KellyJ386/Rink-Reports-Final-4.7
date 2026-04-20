import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

import { getPriceId, getStripe, isStripeConfigured } from './stripe'

/**
 * Create a Stripe Checkout session to convert a trial facility into an active
 * subscription. Called from /admin/billing; Stripe hosts the payment form.
 *
 * On success, Stripe posts `checkout.session.completed` to our webhook, which
 * flips facility_subscriptions.status to 'active' + stores stripe_customer_id
 * + stripe_subscription_id.
 */

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'stripe_not_configured' | 'no_price_id' | 'no_facility' | 'error'; error?: string }

export async function createCheckoutSession(opts: {
  tier: 'single_facility_monthly' | 'single_facility_annual'
  returnUrl?: string
}): Promise<CheckoutResult> {
  if (!isStripeConfigured()) return { ok: false, reason: 'stripe_not_configured' }
  const stripe = getStripe()
  if (!stripe) return { ok: false, reason: 'stripe_not_configured' }

  const priceId = getPriceId(opts.tier)
  if (!priceId) return { ok: false, reason: 'no_price_id' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'no_facility' }

  // Resolve current facility + subscription row
  const { data: sub } = await supabase
    .from('facility_subscriptions')
    .select('facility_id, stripe_customer_id')
    .maybeSingle()

  if (!sub?.facility_id) return { ok: false, reason: 'no_facility' }

  const { data: profile } = await supabase
    .from('users')
    .select('email, full_name, facility_id')
    .eq('id', user.id)
    .maybeSingle()

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.rinkreports.com'

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer: (sub.stripe_customer_id as string | null) ?? undefined,
      customer_email: sub.stripe_customer_id ? undefined : (profile?.email as string | undefined),
      client_reference_id: sub.facility_id as string,
      allow_promotion_codes: true,
      subscription_data: {
        metadata: {
          facility_id: sub.facility_id as string,
        },
      },
      metadata: {
        facility_id: sub.facility_id as string,
      },
      success_url: `${appUrl}/admin/billing?checkout=success`,
      cancel_url: opts.returnUrl ?? `${appUrl}/admin/billing?checkout=canceled`,
    })
    return { ok: true, url: session.url ?? `${appUrl}/admin/billing` }
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// Expose for future platform-admin UI that might pre-fill customer records
export async function ensureStripeCustomerForFacility(facilityId: string): Promise<string | null> {
  if (!isStripeConfigured()) return null
  const stripe = getStripe()
  if (!stripe) return null

  const svc = createServiceClient()
  const { data: sub } = await svc
    .from('facility_subscriptions')
    .select('stripe_customer_id')
    .eq('facility_id', facilityId)
    .maybeSingle()

  const existing = sub?.stripe_customer_id as string | null
  if (existing) return existing

  const { data: facility } = await svc
    .from('facilities')
    .select('name')
    .eq('id', facilityId)
    .maybeSingle()

  const customer = await stripe.customers.create({
    name: (facility?.name as string | undefined) ?? 'Rink Reports Facility',
    metadata: { facility_id: facilityId },
  })

  await svc
    .from('facility_subscriptions')
    .update({ stripe_customer_id: customer.id })
    .eq('facility_id', facilityId)

  return customer.id
}
