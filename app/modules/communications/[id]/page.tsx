import Link from 'next/link'
import { notFound } from 'next/navigation'

import { MarkdownBody } from '@/components/communications/MarkdownBody'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { getAnnouncement } from '@/lib/communications/queries'
import { markRead } from '@/lib/communications/actions'
import { createClient } from '@/lib/supabase/server'

import { AcknowledgeButton } from './AcknowledgeButton'

export default async function AnnouncementDetailPage({
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

  // Stamp read (idempotent — upsert with ignoreDuplicates)
  if (userId) {
    await markRead(id)
  }

  const isAuthor = userId === announcement.author_user_id
  const isAdmin = false // RLS SELECT already enforces access; admin check via has_module_access is DB-side

  const PRIORITY_COLOR: Record<string, string> = {
    urgent: 'bg-red-100 text-red-700',
    important: 'bg-yellow-100 text-yellow-700',
    normal: 'bg-surface-raised text-muted',
  }

  const priorityBadge = PRIORITY_COLOR[announcement.priority] ?? ''

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <Link href="/modules/communications" className="text-sm text-muted hover:text-ink">
          ← Announcements
        </Link>
        <div className="flex gap-3">
          {isAuthor && (
            <>
              <Link
                href={`/modules/communications/${id}/edit`}
                className="text-sm text-accent hover:underline no-underline"
              >
                Edit
              </Link>
              <Link
                href={`/modules/communications/${id}/receipts`}
                className="text-sm text-accent hover:underline no-underline"
              >
                View receipts
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${priorityBadge}`}
          >
            {announcement.priority}
          </span>
          {announcement.is_archived && (
            <span className="text-xs bg-surface-raised text-muted px-2 py-0.5 rounded-full">
              Archived
            </span>
          )}
        </div>

        <h1 className="text-2xl font-semibold">{announcement.title}</h1>

        <p className="text-sm text-muted">
          Posted{' '}
          {new Date(announcement.posted_at).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
          {announcement.expires_at && (
            <>
              {' · Expires '}
              {new Date(announcement.expires_at).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </>
          )}
        </p>

        <hr className="border-hairline" />

        <MarkdownBody body={announcement.body} className="prose prose-sm max-w-none mt-4" />

        {announcement.requires_acknowledgment && (
          <div className="mt-6 rounded-md border border-yellow-200 bg-yellow-50 px-4 py-4">
            {announcement.acknowledged_at ? (
              <p className="text-sm text-yellow-800 font-medium">
                ✓ You acknowledged this on{' '}
                {new Date(announcement.acknowledged_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
            ) : (
              <div>
                <p className="text-sm text-yellow-800 font-medium mb-3">
                  This announcement requires your acknowledgment.
                </p>
                <AcknowledgeButton announcementId={id} />
              </div>
            )}
          </div>
        )}
      </div>

      {isAdmin && !isAuthor && (
        <div className="mt-6 border-t border-hairline pt-4">
          <Link
            href={`/modules/communications/${id}/receipts`}
            className="text-sm text-accent hover:underline"
          >
            View receipts
          </Link>
        </div>
      )}
    </main>
  )
}
