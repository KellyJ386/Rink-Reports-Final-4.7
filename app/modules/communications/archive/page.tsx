import Link from 'next/link'

import { AnnouncementCard } from '@/components/communications/AnnouncementCard'
import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { listAnnouncements } from '@/lib/communications/queries'

export default async function CommunicationsArchivePage() {
  await requireModuleEnabled('communications')
  const announcements = await listAnnouncements({ includeArchived: true })

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Archived announcements</h1>
        <Link href="/modules/communications" className="text-sm text-muted hover:text-ink">
          ← Back to announcements
        </Link>
      </div>

      <div className="mt-6 space-y-2">
        {announcements.length === 0 ? (
          <p className="text-muted text-sm py-8 text-center">No archived announcements.</p>
        ) : (
          announcements.map((a) => (
            <AnnouncementCard key={a.id} announcement={a} />
          ))
        )}
      </div>
    </main>
  )
}
