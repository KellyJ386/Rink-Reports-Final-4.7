import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'

export default async function FormSchemaHistoryPage({
  params,
}: {
  params: Promise<{ module: string; form_type: string }>
}) {
  const { module, form_type: ftParam } = await params
  const formType = ftParam === '_' ? null : ftParam

  const supabase = await createClient()

  const query = supabase
    .from('form_schema_history')
    .select('version, published_at, published_by, users:published_by(full_name)')
    .eq('module_slug', module)
    .order('version', { ascending: false })

  const { data } = formType ? await query.eq('form_type', formType) : await query.is('form_type', null)

  const rows = (data ?? []) as Array<{
    version: number
    published_at: string
    users: { full_name?: string } | null
  }>

  return (
    <main>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Form schema history</h1>
        <Link href={`/admin/forms/${module}/${formType ?? '_'}`}>← Back to editor</Link>
      </div>

      <p className="text-muted text-sm mt-1">
        Every publish snapshots here. Click a version to inspect the JSON; use "Copy JSON" to
        paste it into a new draft if you want to roll back.
      </p>

      <div className="mt-6 overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-muted text-sm">
            No history yet. The current draft is v1; history only appears after a second publish.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-muted">
                <th className="py-2 pr-3 font-medium">Version</th>
                <th className="py-2 pr-3 font-medium">Published</th>
                <th className="py-2 pr-3 font-medium">By</th>
                <th className="py-2 pr-3" aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.version} className="border-b border-hairline">
                  <td className="py-2 pr-3">v{r.version}</td>
                  <td className="py-2 pr-3">{new Date(r.published_at).toLocaleString()}</td>
                  <td className="py-2 pr-3">{r.users?.full_name ?? '—'}</td>
                  <td className="py-2 pr-3">
                    <Link
                      href={`/admin/forms/${module}/${formType ?? '_'}/history/${r.version}`}
                    >
                      View JSON
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  )
}
