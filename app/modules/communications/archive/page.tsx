import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { fetchAnnouncementFeed } from '@/lib/communications/feed'

import { AnnouncementListClient } from '../list-client'
import { hasCommunicationsAdminAccess } from '../admin-check'

export default async function ArchivePage() {
  await requireModuleEnabled('communications')
  const canAdmin = await hasCommunicationsAdminAccess()
  if (!canAdmin) notFound()

  const rows = await fetchAnnouncementFeed({ includeArchived: true, limit: 500 })
  const archivedRows = rows.filter((r) => r.sort_bucket === 5)

  return (
    <main>
      <div className="text-sm">
        <Link href="/modules/communications" className="underline">
          ← Back to announcements
        </Link>
      </div>

      <h1 className="text-xl font-semibold mt-2">Archived announcements</h1>
      <p className="text-muted text-sm mt-1">
        Expired or explicitly archived. Not hard-deleted — admins retain the audit trail.
      </p>

      <div className="mt-6">
        <AnnouncementListClient rows={archivedRows} canPost={false} />
      </div>
    </main>
  )
}
