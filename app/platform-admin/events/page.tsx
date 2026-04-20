import { createClient } from '@/lib/supabase/server'

const PAGE_SIZE = 50

export default async function PlatformAdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; errored?: string }>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number(sp.page ?? '1') || 1)
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const supabase = await createClient()
  let query = supabase
    .from('billing_events')
    .select('stripe_event_id, event_type, processed_at, error_if_any, created_at', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (sp.errored === '1') query = query.not('error_if_any', 'is', null)

  const { data, count } = await query

  return (
    <main>
      <h1 className="text-xl font-semibold">Billing events</h1>
      <p className="text-muted text-sm mt-1">
        Every Stripe webhook received. Errored events are retried hourly via the
        <code>stripe-webhook-retry</code> job.
      </p>

      <div className="mt-4 flex gap-2 text-sm">
        <a
          href="/platform-admin/events"
          className={`no-underline px-3 py-1 rounded ${sp.errored === '1' ? 'text-ink' : 'bg-accent text-white'}`}
        >
          All
        </a>
        <a
          href="/platform-admin/events?errored=1"
          className={`no-underline px-3 py-1 rounded ${sp.errored === '1' ? 'bg-danger text-white' : 'text-danger'}`}
        >
          Errored only
        </a>
      </div>

      <div className="mt-6 overflow-x-auto bg-white border border-hairline rounded-md">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-muted">
              <th className="py-2 px-3 font-medium">When</th>
              <th className="py-2 px-3 font-medium">Event type</th>
              <th className="py-2 px-3 font-medium">Processed</th>
              <th className="py-2 px-3 font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).length === 0 ? (
              <tr><td colSpan={4} className="py-4 text-muted text-sm px-3">No events.</td></tr>
            ) : (
              (data ?? []).map((row: Record<string, unknown>) => (
                <tr key={row.stripe_event_id as string} className="border-b border-hairline">
                  <td className="py-2 px-3 text-muted whitespace-nowrap">
                    {new Date(row.created_at as string).toLocaleString()}
                  </td>
                  <td className="py-2 px-3 font-mono text-xs">{row.event_type as string}</td>
                  <td className="py-2 px-3">
                    {row.processed_at
                      ? <span className="text-ok">✓</span>
                      : <span className="text-warn">pending</span>}
                  </td>
                  <td className="py-2 px-3 text-xs text-danger">
                    {(row.error_if_any as string | null) ?? ''}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <nav aria-label="Pagination" className="mt-4 flex gap-3 text-sm items-center">
        {page > 1 && <a href={`?page=${page - 1}${sp.errored === '1' ? '&errored=1' : ''}`}>← Previous</a>}
        <span className="text-muted">Page {page} · {count ?? 0} total</span>
        {(count ?? 0) > page * PAGE_SIZE && (
          <a href={`?page=${page + 1}${sp.errored === '1' ? '&errored=1' : ''}`}>Next →</a>
        )}
      </nav>
    </main>
  )
}
