import 'server-only'

import { createClient } from '@/lib/supabase/server'

import { getStripe, isStripeConfigured } from './stripe'

export type PortalResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'stripe_not_configured' | 'no_customer' | 'not_authenticated' | 'error'; error?: string }

/**
 * Create a Stripe Billing Portal session for the current facility's customer.
 * Returns the hosted portal URL for the admin UI to redirect to.
 *
 * If Stripe isn't configured, returns ok:false with reason 'stripe_not_configured'
 * — Agent 6's "Manage billing" button stays disabled in that state.
 */
export async function openBillingPortal(opts?: { returnUrl?: string }): Promise<PortalResult> {
  if (!isStripeConfigured()) return { ok: false, reason: 'stripe_not_configured' }
  const stripe = getStripe()
  if (!stripe) return { ok: false, reason: 'stripe_not_configured' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'not_authenticated' }

  const { data: sub } = await supabase
    .from('facility_subscriptions')
    .select('stripe_customer_id')
    .maybeSingle()

  const customerId = sub?.stripe_customer_id as string | undefined
  if (!customerId) return { ok: false, reason: 'no_customer' }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.rinkreports.com'

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: opts?.returnUrl ?? `${appUrl}/admin/billing`,
    })
    return { ok: true, url: session.url }
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
