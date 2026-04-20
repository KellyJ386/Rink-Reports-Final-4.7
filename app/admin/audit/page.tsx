import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'

const PAGE_SIZE = 50
const MAX_PAGES = 500

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; action?: string; from?: string; to?: string }>
}) {
  const sp = await searchParams
  const page = Math.min(MAX_PAGES, Math.max(1, Number(sp.page ?? '1') || 1))
  const from = page * PAGE_SIZE - PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const supabase = await createClient()

  let query = supabase
    .from('audit_log')
    .select(
      'id, action, entity_type, entity_id, created_at, metadata, actor_user_id, users:actor_user_id(full_name)',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, to)

  if (sp.action) query = query.eq('action', sp.action)
  if (sp.from) query = query.gte('created_at', sp.from)
  if (sp.to) query = query.lte('created_at', sp.to)

  const { data, count } = await query
  const totalRows = count ?? 0
  const totalPages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(totalRows / PAGE_SIZE)))

  // Distinct action values for the filter dropdown. Cap to 100 for sanity.
  const { data: distinctActions } = await supabase
    .from('audit_log')
    .select('action')
    .limit(1000)
  const actionSet = new Set<string>()
  for (const r of (distinctActions ?? []) as Array<{ action: string }>) actionSet.add(r.action)
  const actionOptions = [...actionSet].sort()

  return (
    <main>
      <h1 className="text-xl font-semibold">Audit log</h1>
      <p className="text-muted text-sm mt-1">
        Every admin and data action gets an immutable row here. Filter by action or date for faster scans.
      </p>

      <form method="get" className="mt-4 flex gap-3 flex-wrap items-end">
        <label>
          Action
          <select name="action" defaultValue={sp.action ?? ''}>
            <option value="">Any</option>
            {actionOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" name="from" defaultValue={sp.from ?? ''} />
        </label>
        <label>
          To
          <input type="date" name="to" defaultValue={sp.to ?? ''} />
        </label>
        <button type="submit" className="self-end">
          Apply
        </button>
        {(sp.action || sp.from || sp.to) && (
          <Link href="/admin/audit" className="self-end text-sm">
            Clear filters
          </Link>
        )}
      </form>

      <div className="mt-6 overflow-x-auto">
        {(data ?? []).length === 0 ? (
          <p className="text-muted text-sm">No audit rows match.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-muted">
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Actor</th>
                <th className="py-2 pr-3 font-medium">Action</th>
                <th className="py-2 pr-3 font-medium">Entity</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((r: Record<string, unknown>) => (
                <tr key={r.id as string} className="border-b border-hairline align-top">
                  <td className="py-2 pr-3 text-muted whitespace-nowrap">
                    {new Date(r.created_at as string).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3">
                    {(r.users as { full_name?: string } | null)?.full_name ?? '—'}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.action as string}</td>
                  <td className="py-2 pr-3">
                    <div className="text-xs">
                      {(r.entity_type as string) ?? '—'}
                      {r.entity_id ? ` · ${String(r.entity_id).slice(0, 8)}` : ''}
                    </div>
                    {!!r.metadata && Object.keys(r.metadata as object).length > 0 ? (
                      <details className="text-xs text-muted">
                        <summary>metadata</summary>
                        <pre className="mt-1">{JSON.stringify(r.metadata, null, 2)}</pre>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalRows > PAGE_SIZE && (
        <nav aria-label="Pagination" className="mt-4 flex items-center gap-3 text-sm">
          <PageLink
            disabled={page <= 1}
            href={buildHref({ ...sp, page: String(page - 1) })}
          >
            ← Previous
          </PageLink>
          <span className="text-muted">
            Page {page} of {totalPages}
          </span>
          <PageLink
            disabled={page >= totalPages}
            href={buildHref({ ...sp, page: String(page + 1) })}
          >
            Next →
          </PageLink>
          {page === MAX_PAGES && (
            <span className="text-xs text-muted">
              Max pages reached — filter by date to see older entries.
            </span>
          )}
        </nav>
      )}
    </main>
  )
}

function buildHref(sp: Record<string, string | undefined>): string {
  const q = new URLSearchParams()
  if (sp.action) q.set('action', sp.action)
  if (sp.from) q.set('from', sp.from)
  if (sp.to) q.set('to', sp.to)
  if (sp.page) q.set('page', sp.page)
  const s = q.toString()
  return s ? `/admin/audit?${s}` : '/admin/audit'
}

function PageLink({
  disabled,
  href,
  children,
}: {
  disabled: boolean
  href: string
  children: React.ReactNode
}) {
  if (disabled) return <span className="text-muted">{children}</span>
  return <Link href={href}>{children}</Link>
}
