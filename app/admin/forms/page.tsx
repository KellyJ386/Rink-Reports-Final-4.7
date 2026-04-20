import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'

export default async function AdminFormsPage() {
  const supabase = await createClient()

  const { data: schemas } = await supabase
    .from('form_schemas')
    .select(
      'id, module_slug, form_type, version, is_published, draft_definition, updated_at, modules!inner(name)',
    )
    .order('module_slug', { ascending: true })
    .order('form_type', { ascending: true })

  const rows = (schemas ?? []).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    module_slug: s.module_slug as string,
    module_name: (s.modules as { name?: string } | null)?.name ?? (s.module_slug as string),
    form_type: (s.form_type as string | null) ?? null,
    version: s.version as number,
    is_published: s.is_published as boolean,
    has_draft: s.draft_definition !== null,
    updated_at: s.updated_at as string,
  }))

  return (
    <main>
      <h1 className="text-xl font-semibold">Forms</h1>
      <p className="text-muted text-sm mt-1">
        Customize any form without a code deploy. Drafts save freely; publish to take effect.
        Historical submissions always render against the schema version they were filed under.
      </p>

      <div className="mt-6 overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-muted text-sm">No forms configured.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-muted">
                <th className="py-2 pr-3 font-medium">Module</th>
                <th className="py-2 pr-3 font-medium">Form type</th>
                <th className="py-2 pr-3 font-medium">Version</th>
                <th className="py-2 pr-3 font-medium">Draft?</th>
                <th className="py-2 pr-3 font-medium">Updated</th>
                <th className="py-2 pr-3" aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-hairline">
                  <td className="py-2 pr-3">{r.module_name}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.form_type ?? '—'}</td>
                  <td className="py-2 pr-3">v{r.version}</td>
                  <td className="py-2 pr-3">{r.has_draft ? 'Yes' : '—'}</td>
                  <td className="py-2 pr-3 text-muted">
                    {new Date(r.updated_at).toLocaleDateString()}
                  </td>
                  <td className="py-2 pr-3">
                    <Link
                      href={`/admin/forms/${r.module_slug}/${r.form_type ?? '_'}`}
                    >
                      Edit
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
