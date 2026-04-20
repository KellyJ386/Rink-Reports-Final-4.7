import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { getAnnouncement, getReceipts } from '@/lib/communications/queries'
import { createClient } from '@/lib/supabase/server'

export default async function AnnouncementReceiptsPage({
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

  const [announcement, supabase] = await Promise.all([
    getAnnouncement(id),
    createClient(),
  ])

  if (!announcement) notFound()

  const { data: authData } = await supabase.auth.getUser()
  const userId = authData.user?.id

  // Only author can view receipts (admins handled by RLS on reads table)
  if (userId !== announcement.author_user_id) {
    notFound()
  }

  const receipts = await getReceipts(id)

  const readCount = receipts.length
  const ackCount = receipts.filter((r) => r.acknowledged_at).length

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Read receipts</h1>
        <Link
          href={`/modules/communications/${id}`}
          className="text-sm text-muted hover:text-ink"
        >
          ← Back
        </Link>
      </div>

      <div className="text-sm font-medium text-muted mb-1 truncate">{announcement.title}</div>

      <div className="flex gap-6 mt-4 mb-6">
        <div className="text-center">
          <div className="text-2xl font-semibold">{readCount}</div>
          <div className="text-xs text-muted">read</div>
        </div>
        {announcement.requires_acknowledgment && (
          <div className="text-center">
            <div className="text-2xl font-semibold">{ackCount}</div>
            <div className="text-xs text-muted">acknowledged</div>
          </div>
        )}
      </div>

      {receipts.length === 0 ? (
        <p className="text-muted text-sm py-4">No one has read this announcement yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left">
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">Read at</th>
              {announcement.requires_acknowledgment && (
                <th className="pb-2 font-medium">Acknowledged</th>
              )}
            </tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.id} className="border-b border-hairline">
                <td className="py-2">
                  {r.user_full_name ?? r.user_email ?? r.user_id}
                </td>
                <td className="py-2 text-muted">
                  {new Date(r.read_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                {announcement.requires_acknowledgment && (
                  <td className="py-2">
                    {r.acknowledged_at ? (
                      <span className="text-green-600 font-medium">✓</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                )}
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
      )}
      </div>
    </main>
  )
}
