'use server'

import { createCheckoutSession } from '@/lib/billing/checkout'
import { openBillingPortal } from '@/lib/billing/portal'

export async function startCheckoutAction(
  tier: 'single_facility_monthly' | 'single_facility_annual',
) {
  return createCheckoutSession({ tier })
}

export async function openPortalAction() {
  return openBillingPortal()
}
