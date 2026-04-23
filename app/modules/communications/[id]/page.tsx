import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { fetchAnnouncementById } from '@/lib/communications/feed'
import { markAnnouncementRead } from '@/lib/communications/read'

import { hasCommunicationsAdminAccess } from '../admin-check'
import { AnnouncementDetailClient } from './detail-client'

export default async function AnnouncementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireModuleEnabled('communications')
  const { id } = await params

  const announcement = await fetchAnnouncementById(id)
  if (!announcement) notFound()

  // Best-effort: record read-at on load. Idempotent — a second load keeps the
  // original read_at. Errors are swallowed (UX over failing the page load).
  await markAnnouncementRead(id)

  const canAdmin = await hasCommunicationsAdminAccess()

  return (
    <main>
      <div className="text-sm">
        <Link href="/modules/communications" className="underline">
          ← Back to announcements
        </Link>
      </div>
      <AnnouncementDetailClient
        announcement={announcement}
        canAdmin={canAdmin}
      />
    </main>
  )
}
