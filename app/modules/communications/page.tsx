import Link from 'next/link'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { fetchAnnouncementFeed } from '@/lib/communications/feed'

import { AnnouncementListClient } from './list-client'
import { hasCommunicationsAdminAccess } from './admin-check'

export default async function CommunicationsHomePage({
  searchParams,
}: {
  searchParams: Promise<{ show_archived?: string }>
}) {
  await requireModuleEnabled('communications')
  const sp = await searchParams
  const showArchived = sp.show_archived === '1'

  const [rows, canPost] = await Promise.all([
    fetchAnnouncementFeed({ includeArchived: showArchived, limit: 200 }),
    hasCommunicationsAdminAccess(),
  ])

  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Announcements</h1>
        {canPost ? (
          <Link
            href="/modules/communications/new"
            className="no-underline bg-accent text-white px-4 py-2 rounded-md font-medium"
          >
            + New announcement
          </Link>
        ) : null}
      </div>
      <p className="text-muted text-sm mt-1">
        Facility-wide bulletins. Urgent posts email staff; acknowledgments are tracked.
      </p>
      <div className="mt-4 flex items-center gap-4 text-sm">
        <Link
          href={showArchived ? '/modules/communications' : '/modules/communications?show_archived=1'}
          className="underline"
        >
          {showArchived ? 'Hide archived' : 'Show archived'}
        </Link>
        {canPost ? (
          <Link href="/modules/communications/archive" className="underline">
            Archive / audit view
          </Link>
        ) : null}
      </div>
      <div className="mt-6">
        <AnnouncementListClient rows={rows} canPost={canPost} />
      </div>
    </main>
  )
}
