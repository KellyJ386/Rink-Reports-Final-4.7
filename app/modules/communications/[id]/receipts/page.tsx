import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { fetchAnnouncementReceipts } from '@/lib/communications/receipts'
import { fetchAnnouncementById } from '@/lib/communications/feed'

import { hasCommunicationsAdminAccess } from '../../admin-check'

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

export default async function ReceiptsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireModuleEnabled('communications')
  const { id } = await params

  const canAdmin = await hasCommunicationsAdminAccess()
  if (!canAdmin) notFound()

  const [announcement, summary] = await Promise.all([
    fetchAnnouncementById(id),
    fetchAnnouncementReceipts(id),
  ])

  if (!announcement || !summary) notFound()

  return (
    <main>
      <div className="text-sm">
        <Link href={`/modules/communications/${id}`} className="underline">
          ← Back to announcement
        </Link>
      </div>

      <h1 className="text-xl font-semibold mt-2">Read receipts</h1>
      <p className="text-muted text-sm mt-1 truncate">{announcement.title}</p>

      <div className="mt-6 grid grid-cols-3 gap-4 max-w-xl">
        <div className="p-3 rounded-md border">
          <div className="text-xs text-muted">Recipients</div>
          <div className="text-xl font-semibold">{summary.total_recipients}</div>
        </div>
        <div className="p-3 rounded-md border">
          <div className="text-xs text-muted">Read</div>
          <div className="text-xl font-semibold">{summary.read_count}</div>
        </div>
        {summary.requires_acknowledgment ? (
          <div className="p-3 rounded-md border">
            <div className="text-xs text-muted">Acknowledged</div>
            <div className="text-xl font-semibold">{summary.acknowledged_count}</div>
          </div>
        ) : null}
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm border">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Email</th>
              <th className="text-left px-3 py-2">Roles</th>
              <th className="text-left px-3 py-2">Read at</th>
              {summary.requires_acknowledgment ? (
                <th className="text-left px-3 py-2">Acknowledged at</th>
              ) : null}
              <th className="text-left px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => (
              <tr key={r.user_id} className="border-t">
                <td className="px-3 py-2">{r.full_name ?? '—'}</td>
                <td className="px-3 py-2">{r.email}</td>
                <td className="px-3 py-2">{r.role_names.join(', ')}</td>
                <td className="px-3 py-2">{formatDateTime(r.read_at)}</td>
                {summary.requires_acknowledgment ? (
                  <td className="px-3 py-2">{formatDateTime(r.acknowledged_at)}</td>
                ) : null}
                <td className="px-3 py-2">
                  <span
                    className={
                      r.status === 'acknowledged'
                        ? 'text-green-700'
                        : r.status === 'read'
                          ? 'text-slate-700'
                          : 'text-amber-700'
                    }
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
