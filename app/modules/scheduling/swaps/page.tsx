import Link from 'next/link'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { fetchMySwaps } from '@/lib/scheduling/swap'
import { loadSchedulingSettings } from '@/lib/scheduling/settings'
import { createClient } from '@/lib/supabase/server'

import { SwapsClient } from './client'

export default async function SwapsPage() {
  await requireModuleEnabled('scheduling')
  const supabase = await createClient()
  const { data: userResp } = await supabase.auth.getUser()
  const uid = userResp.user?.id ?? null

  const [swaps, settings] = await Promise.all([
    fetchMySwaps(),
    loadSchedulingSettings(),
  ])

  return (
    <main>
      <div className="text-sm">
        <Link href="/modules/scheduling" className="underline">← My schedule</Link>
      </div>
      <h1 className="text-xl font-semibold mt-2">Swaps</h1>
      <p className="text-muted text-sm mt-1">
        {settings.swap_approval_mode === 'free'
          ? 'When a target accepts a swap, the reassignment happens immediately.'
          : 'Accepted swaps go to a manager for approval before the reassignment.'}
      </p>
      <SwapsClient swaps={swaps} currentUserId={uid} />
    </main>
  )
}
