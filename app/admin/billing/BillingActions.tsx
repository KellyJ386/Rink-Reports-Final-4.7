'use client'

import { useState } from 'react'

import { openPortalAction, startCheckoutAction } from './actions'

type Props = {
  subscriptionStatus: string
  stripeConfigured: boolean
  hasCustomer: boolean
}

export function BillingActions({ subscriptionStatus, stripeConfigured, hasCustomer }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubscribe = async (tier: 'single_facility_monthly' | 'single_facility_annual') => {
    setBusy(true)
    setError(null)
    const r = await startCheckoutAction(tier)
    setBusy(false)
    if (!r.ok) {
      setError(r.reason === 'stripe_not_configured' ? 'Billing not configured yet.' : r.error ?? r.reason)
      return
    }
    window.location.href = r.url
  }

  const handlePortal = async () => {
    setBusy(true)
    setError(null)
    const r = await openPortalAction()
    setBusy(false)
    if (!r.ok) {
      setError(
        r.reason === 'stripe_not_configured'
          ? 'Billing not configured yet.'
          : r.reason === 'no_customer'
            ? 'Stripe customer not created — subscribe first.'
            : r.error ?? r.reason,
      )
      return
    }
    window.location.href = r.url
  }

  const canPortal = stripeConfigured && hasCustomer

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}

      {subscriptionStatus !== 'active' && (
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => handleSubscribe('single_facility_monthly')}
            disabled={busy || !stripeConfigured}
            title={!stripeConfigured ? 'Available once billing is configured' : undefined}
            className="bg-accent text-white px-4 py-2 rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Subscribe — monthly
          </button>
          <button
            type="button"
            onClick={() => handleSubscribe('single_facility_annual')}
            disabled={busy || !stripeConfigured}
            title={!stripeConfigured ? 'Available once billing is configured' : undefined}
            className="bg-transparent border border-accent text-accent px-4 py-2 rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Subscribe — annual (save ~17%)
          </button>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={handlePortal}
          disabled={busy || !canPortal}
          title={!canPortal ? 'Available once a subscription exists' : undefined}
          className={
            'px-4 py-2 rounded-md font-medium ' +
            (canPortal
              ? 'bg-ink text-white'
              : 'bg-muted text-white opacity-70 cursor-not-allowed')
          }
        >
          Manage billing
        </button>
        {!stripeConfigured && (
          <p className="text-xs text-muted mt-1">
            Available once billing is configured. Stripe keys pending.
          </p>
        )}
      </div>
    </div>
  )
}
