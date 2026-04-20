import Link from 'next/link'

import { listTemplates } from '@/lib/ice-depth/template'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

export default async function IceDepthTemplatesPage() {
  await requireModuleEnabled('ice_depth')
  const templates = await listTemplates()

  return (
    <main>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Ice Depth templates</h1>
        <div className="flex gap-2">
          <Link href="/modules/ice-depth">← Back to sessions</Link>
          <Link
            href="/modules/ice-depth/templates/new"
            className="no-underline bg-accent text-white px-4 py-2 rounded-md font-medium"
          >
            + New template
          </Link>
        </div>
      </div>

      <p className="text-muted text-sm mt-1">
        One template per ice surface. Only users with admin access on Ice Depth can create or edit.
      </p>

      <div className="mt-6 overflow-x-auto">
        {templates.length === 0 ? (
          <p className="text-muted text-sm">No templates yet.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-muted">
                <th className="py-2 pr-3 font-medium">Surface</th>
                <th className="py-2 pr-3 font-medium">Template</th>
                <th className="py-2 pr-3 font-medium">Version</th>
                <th className="py-2 pr-3 font-medium">Draft?</th>
                <th className="py-2 pr-3 font-medium">Points</th>
                <th className="py-2 pr-3" aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b border-hairline">
                  <td className="py-2 pr-3">{t.surface_name}</td>
                  <td className="py-2 pr-3">{t.name}</td>
                  <td className="py-2 pr-3">v{t.version}</td>
                  <td className="py-2 pr-3">{t.has_draft ? 'Yes' : '—'}</td>
                  <td className="py-2 pr-3">{t.current_points.length}</td>
                  <td className="py-2 pr-3">
                    <Link href={`/modules/ice-depth/templates/${t.id}/edit`}>Edit</Link>
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
