import 'server-only'

import Stripe from 'stripe'

/**
 * Lazily-initialized Stripe client. Returns null when STRIPE_SECRET_KEY is not
 * configured — callers should check and render stubbed UI (Agent 6's "Manage
 * billing" button stays disabled with a tooltip in that state).
 */

let cached: Stripe | null | undefined

export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    cached = null
    return null
  }
  // Use Stripe's current default API version — the TS types pin a specific version
  // per stripe-node release, and overriding causes type mismatches. Production
  // pins via the Stripe dashboard.
  cached = new Stripe(key)
  return cached
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

export function getPriceId(tier: 'single_facility_monthly' | 'single_facility_annual'): string | null {
  switch (tier) {
    case 'single_facility_monthly':
      return process.env.STRIPE_PRICE_ID_SINGLE_FACILITY_MONTHLY ?? null
    case 'single_facility_annual':
      return process.env.STRIPE_PRICE_ID_SINGLE_FACILITY_ANNUAL ?? null
  }
}
