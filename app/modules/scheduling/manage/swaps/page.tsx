import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { fetchPendingManagerSwaps } from '@/lib/scheduling/swap'
import { loadSchedulingSettings } from '@/lib/scheduling/settings'

import { hasSchedulingAdminAccess } from '../../admin-check'
import { SwapQueueClient } from './client'

export default async function SwapQueuePage() {
  await requireModuleEnabled('scheduling')
  if (!(await hasSchedulingAdminAccess())) notFound()

  const [pending, settings] = await Promise.all([
    fetchPendingManagerSwaps(),
    loadSchedulingSettings(),
  ])

  return (
    <main>
      <div className="text-sm">
        <Link href="/modules/scheduling/manage" className="underline">← Manage schedules</Link>
      </div>
      <h1 className="text-xl font-semibold mt-2">Swap approvals</h1>
      <p className="text-muted text-sm mt-1">
        Mode: <strong>{settings.swap_approval_mode}</strong>.
        {settings.swap_approval_mode === 'free'
          ? ' Swaps reassign automatically when the target accepts — this queue is effectively read-only.'
          : ' Target-accepted swaps wait here until you decide.'}
      </p>
      <SwapQueueClient swaps={pending} />
    </main>
  )
}
