import Link from 'next/link'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { getSetting } from '@/lib/facility/settings'
import { createClient } from '@/lib/supabase/server'

import { NewAnnouncementClient } from './client'

export default async function NewAnnouncementPage() {
  await requireModuleEnabled('communications')

  const [requireAck, expiryDays] = await Promise.all([
    getSetting('communications.require_ack_enabled'),
    getSetting('communications.default_expiry_days'),
  ])

  const supabase = await createClient()
  const { data: roles } = await supabase
    .from('roles')
    .select('id, name')
    .order('name', { ascending: true })

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">New announcement</h1>
        <Link href="/modules/communications" className="text-sm text-muted hover:text-ink">
          ← Cancel
        </Link>
      </div>
      <NewAnnouncementClient
        defaultRequireAck={requireAck}
        defaultExpiryDays={expiryDays}
        roles={roles ?? []}
      />
    </main>
  )
}
