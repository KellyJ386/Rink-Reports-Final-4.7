import Link from 'next/link'

import { resolveBannerState } from '@/lib/billing/require-active-subscription'

/**
 * Global subscription banner. Renders nothing when the subscription is healthy
 * (active, trialing > 7 days, or no row). Shows warnings for trialing-soon,
 * past_due (grace), past_due (locked), canceled.
 */
export async function SubscriptionBanner() {
  const state = await resolveBannerState()

  if (state.kind === 'none') return null

  const styles: Record<string, string> = {
    trialing_soon: 'bg-amber-50 border-amber-400 text-amber-900',
    past_due_grace: 'bg-amber-50 border-amber-400 text-amber-900',
    past_due_locked: 'bg-red-50 border-danger text-ink',
    canceled: 'bg-red-50 border-danger text-ink',
  }

  return (
    <div className={`border-l-4 px-4 py-2 text-sm flex items-center justify-between gap-3 ${styles[state.kind] ?? ''}`}>
      <span>
        <strong>Billing:</strong> {state.message}
      </span>
      <Link href="/admin/billing" className="no-underline font-medium">
        Manage billing →
      </Link>
    </div>
  )
}
