import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { fetchPendingTimeOffForFacility } from '@/lib/scheduling/time-off'
import { createClient } from '@/lib/supabase/server'

import { hasSchedulingAdminAccess } from '../../admin-check'
import { TimeOffQueueClient } from './client'

export default async function TimeOffQueuePage() {
  await requireModuleEnabled('scheduling')
  if (!(await hasSchedulingAdminAccess())) notFound()

  const pending = await fetchPendingTimeOffForFacility()

  const ids = Array.from(new Set(pending.map((p) => p.user_id)))
  const supabase = await createClient()
  const { data: users } = ids.length
    ? await supabase
        .from('users')
        .select('id, full_name, email')
        .in('id', ids)
    : { data: [] }
  const nameByUser = new Map<string, string>()
  for (const u of (users ?? []) as Array<{ id: string; full_name: string | null; email: string }>) {
    nameByUser.set(u.id, u.full_name ?? u.email)
  }

  return (
    <main>
      <div className="text-sm">
        <Link href="/modules/scheduling/manage" className="underline">← Manage schedules</Link>
      </div>
      <h1 className="text-xl font-semibold mt-2">Time-off approvals</h1>
      <p className="text-muted text-sm mt-1">
        Pending requests from staff. Approving does not auto-adjust the schedule — that&rsquo;s still your call.
      </p>
      <TimeOffQueueClient
        requests={pending}
        userLabels={Object.fromEntries(nameByUser)}
      />
    </main>
  )
}
