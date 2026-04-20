import Link from 'next/link'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

export default async function PlatformFacilityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: facility }, { data: sub }, { count: userCount }, { count: inviteCount }] = await Promise.all([
    supabase
      .from('facilities')
      .select('id, slug, name, timezone, plan_tier, is_platform, settings, created_at, address')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('facility_subscriptions')
      .select('status, plan_tier, trial_end, current_period_end, stripe_customer_id, stripe_subscription_id')
      .eq('facility_id', id)
      .maybeSingle(),
    supabase.from('users').select('*', { count: 'exact', head: true }).eq('facility_id', id),
    supabase
      .from('facility_invites')
      .select('*', { count: 'exact', head: true })
      .eq('facility_id', id)
      .is('accepted_at', null)
      .is('revoked_at', null),
  ])

  if (!facility) notFound()

  return (
    <main>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">{facility.name}</h1>
        <div className="flex gap-2">
          <form action={`/platform-admin/facilities/${facility.id}/impersonate`} method="POST">
            <button
              type="submit"
              className="bg-amber-600 text-white px-4 py-2 rounded-md font-medium"
            >
              Impersonate
            </button>
          </form>
          <Link href="/platform-admin/facilities" className="self-center">← Back</Link>
        </div>
      </div>

      <p className="text-muted text-sm mt-1">
        Slug: <code>{facility.slug}</code> · Timezone: {facility.timezone} · Plan:{' '}
        {facility.plan_tier}
      </p>

      <section className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Users" value={String(userCount ?? 0)} />
        <Card label="Outstanding invites" value={String(inviteCount ?? 0)} />
        <Card label="Subscription" value={(sub?.status as string) ?? 'none'} />
        <Card label="Plan tier" value={(sub?.plan_tier as string) ?? '—'} />
      </section>

      {sub && (
        <section className="mt-6 border border-hairline rounded-md p-4 bg-white">
          <h2 className="font-semibold mb-2 text-sm">Subscription</h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Status</dt><dd>{sub.status}</dd>
            {sub.trial_end && <><dt className="text-muted">Trial ends</dt><dd>{new Date(sub.trial_end as string).toLocaleString()}</dd></>}
            {sub.current_period_end && <><dt className="text-muted">Period ends</dt><dd>{new Date(sub.current_period_end as string).toLocaleString()}</dd></>}
            {sub.stripe_customer_id && <><dt className="text-muted">Stripe customer</dt><dd className="font-mono text-xs break-all">{sub.stripe_customer_id}</dd></>}
            {sub.stripe_subscription_id && <><dt className="text-muted">Stripe subscription</dt><dd className="font-mono text-xs break-all">{sub.stripe_subscription_id}</dd></>}
          </dl>
        </section>
      )}

      <section className="mt-6 border border-hairline rounded-md p-4 bg-white">
        <h2 className="font-semibold mb-2 text-sm">Address</h2>
        <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(facility.address, null, 2)}</pre>
      </section>
    </main>
  )
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-hairline rounded-md p-3 bg-white">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="text-2xl font-semibold mt-1 capitalize">{value}</div>
    </div>
  )
}
