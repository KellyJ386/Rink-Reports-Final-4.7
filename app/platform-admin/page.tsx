import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'

export default async function PlatformAdminDashboardPage() {
  const supabase = await createClient()

  const [
    { count: facilityCount },
    { count: trialCount },
    { count: pastDueCount },
    { count: activeImpersonations },
    { count: unprocessedEvents },
  ] = await Promise.all([
    supabase.from('facilities').select('*', { count: 'exact', head: true }).eq('is_platform', false),
    supabase.from('facility_subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'trialing'),
    supabase.from('facility_subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'past_due'),
    supabase.from('impersonation_sessions').select('*', { count: 'exact', head: true }).is('ended_at', null),
    supabase.from('billing_events').select('*', { count: 'exact', head: true }).is('processed_at', null),
  ])

  return (
    <main>
      <h1 className="text-xl font-semibold">Platform admin</h1>
      <p className="text-muted text-sm mt-1">
        Every facility across Rink Reports. Impersonate to act as a facility admin for support.
      </p>

      <section className="mt-6 grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card label="Facilities" value={String(facilityCount ?? 0)} href="/platform-admin/facilities" />
        <Card label="In trial" value={String(trialCount ?? 0)} href="/platform-admin/facilities?status=trialing" />
        <Card label="Past due" value={String(pastDueCount ?? 0)} href="/platform-admin/facilities?status=past_due" />
        <Card label="Active impersonations" value={String(activeImpersonations ?? 0)} href="/platform-admin/health" />
        <Card label="Unprocessed events" value={String(unprocessedEvents ?? 0)} href="/platform-admin/events" />
      </section>

      <div className="mt-6 flex gap-2">
        <Link
          href="/platform-admin/facilities/new"
          className="no-underline bg-accent text-white px-4 py-2 rounded-md font-medium"
        >
          + Create facility
        </Link>
      </div>
    </main>
  )
}

function Card({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link href={href} className="no-underline block border border-hairline rounded-md p-3 bg-white text-ink">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </Link>
  )
}
