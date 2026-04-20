import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { getAnnouncement, getReceipts } from '@/lib/communications/queries'
import { createClient } from '@/lib/supabase/server'

export default async function AnnouncementReceiptsPage({
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
