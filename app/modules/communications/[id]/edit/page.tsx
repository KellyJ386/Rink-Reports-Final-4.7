import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { getAnnouncement, hasReads as checkHasReads } from '@/lib/communications/queries'
import { createClient } from '@/lib/supabase/server'

import { EditAnnouncementClient } from './client'

export default async function EditAnnouncementPage({
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

  // Only author or admin can edit
  if (userId !== announcement.author_user_id) {
    notFound()
  }

  const [readsExist, rolesResult] = await Promise.all([
    checkHasReads(id),
    supabase.from('roles').select('id, name').order('name', { ascending: true }),
  ])

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Edit announcement</h1>
        <Link
          href={`/modules/communications/${id}`}
          className="text-sm text-muted hover:text-ink"
        >
          ← Cancel
        </Link>
      </div>
      <EditAnnouncementClient
        announcement={announcement}
        hasReads={readsExist}
        roles={rolesResult.data ?? []}
      />
    </main>
  )
}
