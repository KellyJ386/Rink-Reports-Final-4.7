import { notFound } from 'next/navigation'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { createClient } from '@/lib/supabase/server'

import { hasCommunicationsAdminAccess } from '../admin-check'
import { NewAnnouncementClient } from './new-client'

export default async function NewAnnouncementPage() {
  await requireModuleEnabled('communications')
  const canPost = await hasCommunicationsAdminAccess()
  if (!canPost) notFound()

  const supabase = await createClient()
  const { data: roles } = await supabase
    .from('roles')
    .select('id, name, description')
    .order('name', { ascending: true })

  return (
    <main>
      <h1 className="text-xl font-semibold">New announcement</h1>
      <p className="text-muted text-sm mt-1">
        Posted immediately. Urgent priority emails recipients; all priorities notify in-app.
      </p>
      <div className="mt-6">
        <NewAnnouncementClient roles={(roles ?? []) as Array<{ id: string; name: string; description: string | null }>} />
      </div>
    </main>
  )
}
