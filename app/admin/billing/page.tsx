import { createClient } from '@/lib/supabase/server'

export default async function AdminBillingPage() {
  const supabase = await createClient()

  const { data: sub } = await supabase
    .from('facility_subscriptions')
    .select('status, plan_tier, trial_end, current_period_end, stripe_customer_id')
    .maybeSingle()

  const status = (sub?.status as string | null) ?? 'unknown'
  const isTrial = status === 'trialing'
  const trialDaysLeft = sub?.trial_end
    ? Math.max(
        0,
        Math.round(
          (new Date(sub.trial_end as string).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        ),
      )
    : null

  return (
    <main>
      <h1 className="text-xl font-semibold">Billing</h1>
      <p className="text-muted text-sm mt-1">
        Manage your subscription and payment method.
      </p>

      <section className="mt-6 border border-hairline rounded-md p-4 max-w-md">
        <div className="text-xs uppercase tracking-wide text-muted">Subscription</div>
        <div className="text-2xl font-semibold mt-1 capitalize">{status.replace('_', ' ')}</div>
        <div className="text-sm text-muted mt-1">
          Plan: <strong>{(sub?.plan_tier as string | null) ?? '—'}</strong>
        </div>
        {isTrial && trialDaysLeft != null && (
          <div className="text-sm mt-2">
            Trial ends in <strong>{trialDaysLeft}</strong> day{trialDaysLeft === 1 ? '' : 's'}.
          </div>
        )}
        {sub?.current_period_end && (
          <div className="text-sm text-muted mt-1">
            Next bill:{' '}
            {new Date(sub.current_period_end as string).toLocaleDateString()}
          </div>
        )}
      </section>

      <section className="mt-6">
        <button
          type="button"
          disabled
          title="Available once billing is configured"
          className="bg-muted text-white px-4 py-2 rounded-md font-medium opacity-70 cursor-not-allowed"
        >
          Manage billing
        </button>
        <p className="text-xs text-muted mt-2">
          Available once billing is configured — Agent 7 wires the Stripe Customer Portal.
        </p>
      </section>
    </main>
  )
}
