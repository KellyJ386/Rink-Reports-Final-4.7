'use client'

import Link from 'next/link'

import type { AnnouncementFeedRow } from '@/lib/communications/types'

function priorityBadge(p: AnnouncementFeedRow['priority']) {
  const styles: Record<AnnouncementFeedRow['priority'], string> = {
    urgent: 'bg-red-100 text-red-900 border-red-300',
    important: 'bg-amber-100 text-amber-900 border-amber-300',
    normal: 'bg-slate-100 text-slate-700 border-slate-300',
  }
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded border ${styles[p]}`}>
      {p}
    </span>
  )
}

function unreadDot(row: AnnouncementFeedRow) {
  if (row.sort_bucket === 5) return null
  const isUnread = row.sort_bucket <= 3
  if (!isUnread) return null
  return (
    <span
      aria-label="unread"
      className="inline-block w-2 h-2 bg-accent rounded-full"
    />
  )
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function AnnouncementListClient({
  rows,
  canPost,
}: {
  rows: AnnouncementFeedRow[]
  canPost: boolean
}) {
  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-muted">
        <p>No announcements yet.</p>
        {canPost ? (
          <p className="text-sm mt-2">
            <Link href="/modules/communications/new" className="underline">
              Post the first one
            </Link>
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <ul className="divide-y border rounded-md">
      {rows.map((row) => (
        <li key={row.id} className={row.sort_bucket === 5 ? 'opacity-60' : ''}>
          <Link
            href={`/modules/communications/${row.id}`}
            className="block no-underline text-inherit hover:bg-slate-50 p-4"
          >
            <div className="flex items-start gap-3">
              <div className="pt-1.5">{unreadDot(row)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {priorityBadge(row.priority)}
                  {row.requires_acknowledgment && row.acknowledged_at === null ? (
                    <span className="inline-block text-xs px-2 py-0.5 rounded border bg-accent/10 text-accent border-accent/30">
                      needs acknowledgment
                    </span>
                  ) : null}
                  {row.sort_bucket === 5 ? (
                    <span className="inline-block text-xs px-2 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-300">
                      archived
                    </span>
                  ) : null}
                </div>
                <div className="font-medium mt-1">{row.title}</div>
                <div className="text-xs text-muted mt-1">
                  {row.author_name ?? 'Unknown author'} · {formatDate(row.posted_at)}
                </div>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
