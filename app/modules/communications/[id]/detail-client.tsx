'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { MarkdownRenderer } from '@/components/communications/MarkdownRenderer'

import { acknowledgeAction, archiveAction } from '../actions'

type Announcement = {
  id: string
  title: string
  body: string
  priority: 'normal' | 'important' | 'urgent'
  posted_at: string
  expires_at: string | null
  is_archived: boolean
  requires_acknowledgment: boolean
  author_name: string | null
  read_at: string | null
  acknowledged_at: string | null
}

function priorityBadge(p: Announcement['priority']) {
  const styles: Record<Announcement['priority'], string> = {
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

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString()
}

export function AnnouncementDetailClient({
  announcement,
  canAdmin,
}: {
  announcement: Announcement
  canAdmin: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [ackedAt, setAckedAt] = useState<string | null>(announcement.acknowledged_at)
  const [error, setError] = useState<string | null>(null)

  const onAcknowledge = () => {
    setError(null)
    startTransition(async () => {
      const res = await acknowledgeAction(announcement.id)
      if (res.ok) {
        setAckedAt(new Date().toISOString())
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  const onArchive = () => {
    if (!confirm('Archive this announcement? Staff will still be able to view it under "Show archived".')) return
    setError(null)
    startTransition(async () => {
      const res = await archiveAction(announcement.id)
      if (!res.ok) setError(res.error)
      else router.refresh()
    })
  }

  return (
    <article className="mt-2">
      <div className="flex items-center gap-2 flex-wrap">
        {priorityBadge(announcement.priority)}
        {announcement.is_archived ? (
          <span className="inline-block text-xs px-2 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-300">
            archived
          </span>
        ) : null}
      </div>
      <h1 className="text-2xl font-semibold mt-3">{announcement.title}</h1>
      <div className="text-sm text-muted mt-1">
        {announcement.author_name ?? 'Unknown author'} · {formatDateTime(announcement.posted_at)}
        {announcement.expires_at ? (
          <> · expires {formatDateTime(announcement.expires_at)}</>
        ) : null}
      </div>

      <div className="mt-6">
        <MarkdownRenderer>{announcement.body}</MarkdownRenderer>
      </div>

      {announcement.requires_acknowledgment ? (
        <div className="mt-8 p-4 rounded-md border bg-slate-50">
          {ackedAt ? (
            <div className="text-sm">
              ✓ Acknowledged at {formatDateTime(ackedAt)}
            </div>
          ) : (
            <>
              <p className="text-sm">This announcement requires your acknowledgment.</p>
              <button
                type="button"
                onClick={onAcknowledge}
                disabled={pending}
                className="mt-3 bg-accent text-white px-4 py-2 rounded-md font-medium disabled:opacity-50"
              >
                {pending ? 'Acknowledging…' : 'I acknowledge'}
              </button>
            </>
          )}
        </div>
      ) : null}

      {error ? <p className="mt-4 text-red-700 text-sm">{error}</p> : null}

      {canAdmin ? (
        <div className="mt-10 pt-6 border-t flex items-center gap-4 text-sm">
          <Link
            href={`/modules/communications/${announcement.id}/receipts`}
            className="underline"
          >
            View read receipts
          </Link>
          {!announcement.is_archived ? (
            <button
              type="button"
              onClick={onArchive}
              disabled={pending}
              className="underline text-red-700 disabled:opacity-50"
            >
              {pending ? 'Archiving…' : 'Archive'}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
