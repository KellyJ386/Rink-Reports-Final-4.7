import Link from 'next/link'

import { listSessions } from '@/lib/ice-depth/session'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'

export default async function IceDepthHistoryPage() {
  await requireModuleEnabled('ice_depth')
  const sessions = await listSessions()

  return (
    <main>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Ice Depth sessions</h1>
        <div className="flex gap-2">
          <Link href="/modules/ice-depth/trends" className="no-underline text-sm">
            Trends →
          </Link>
          <Link href="/modules/ice-depth/templates" className="no-underline text-sm">
            Templates →
          </Link>
          <Link
            href="/modules/ice-depth/new"
            className="no-underline bg-accent text-white px-4 py-2 rounded-md font-medium"
          >
            + New session
          </Link>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        {sessions.length === 0 ? (
          <p className="text-muted text-sm">No sessions yet. Start one with “+ New session”.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-muted">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Surface</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">By</th>
                <th className="py-2 pr-3 font-medium">Schema</th>
                <th className="py-2 pr-3" aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-b border-hairline">
                  <td className="py-2 pr-3">
                    {new Date(s.submitted_at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3">{s.surface_name}</td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="py-2 pr-3">{s.submitted_by_name ?? '—'}</td>
                  <td className="py-2 pr-3">v{s.form_schema_version}</td>
                  <td className="py-2 pr-3">
                    {s.status === 'in_progress' ? (
                      <Link href={`/modules/ice-depth/${s.id}/run`}>Continue</Link>
                    ) : (
                      <Link href={`/modules/ice-depth/${s.id}`}>View</Link>
                    )}
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

function StatusBadge({ status }: { status: 'in_progress' | 'completed' | 'abandoned' }) {
  const styles: Record<string, string> = {
    in_progress: 'bg-amber-100 text-amber-900',
    completed: 'bg-emerald-100 text-emerald-900',
    abandoned: 'bg-gray-200 text-gray-700',
  }
  const label: Record<string, string> = {
    in_progress: 'In progress',
    completed: 'Completed',
    abandoned: 'Abandoned',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {label[status] ?? status}
    </span>
  )
}
