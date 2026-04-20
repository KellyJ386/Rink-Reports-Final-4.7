import { createClient } from '@/lib/supabase/server'

export default async function PlatformAdminHealthPage() {
  const supabase = await createClient()

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [
    { count: unprocessedEvents },
    { count: errorEvents },
    { count: activeImpersonations },
    { data: recentErrors },
    { count: pastDueFacilities },
  ] = await Promise.all([
    supabase.from('billing_events').select('*', { count: 'exact', head: true }).is('processed_at', null),
    supabase
      .from('billing_events')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', oneDayAgo)
      .not('error_if_any', 'is', null),
    supabase
      .from('impersonation_sessions')
      .select('*', { count: 'exact', head: true })
      .is('ended_at', null),
    supabase
      .from('billing_events')
      .select('stripe_event_id, event_type, error_if_any, created_at')
      .not('error_if_any', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('facility_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'past_due'),
  ])

  return (
    <main>
      <h1 className="text-xl font-semibold">Health</h1>
      <p className="text-muted text-sm mt-1">Last 24 hours.</p>

      <section className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Unprocessed Stripe events" value={String(unprocessedEvents ?? 0)} />
        <Card label="Errored events (24h)" value={String(errorEvents ?? 0)} />
        <Card label="Active impersonations" value={String(activeImpersonations ?? 0)} />
        <Card label="Past-due facilities" value={String(pastDueFacilities ?? 0)} />
      </section>

      <section className="mt-6 bg-white border border-hairline rounded-md p-4">
        <h2 className="font-semibold mb-2 text-sm">Recent errored events</h2>
        {!recentErrors || recentErrors.length === 0 ? (
          <p className="text-muted text-sm">No errored events in the last 24 hours.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-muted">
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Event</th>
                <th className="py-2 pr-3 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {(recentErrors as Array<Record<string, unknown>>).map((r) => (
                <tr key={r.stripe_event_id as string} className="border-b border-hairline align-top">
                  <td className="py-2 pr-3 text-muted whitespace-nowrap">
                    {new Date(r.created_at as string).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.event_type as string}</td>
                  <td className="py-2 pr-3 text-xs">{r.error_if_any as string}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-hairline rounded-md p-3 bg-white">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  )
}
