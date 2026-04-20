import Link from 'next/link'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { createClient } from '@/lib/supabase/server'
import { fetchMyShiftsForWeek } from '@/lib/scheduling/schedule'
import { currentWeekStart, shiftWeek } from '@/lib/scheduling/week'

import { NewSwapClient } from './client'

export default async function NewSwapPage() {
  await requireModuleEnabled('scheduling')
  const supabase = await createClient()

  // Offer the next 4 weeks of my own shifts as the "requester shift" candidate
  const start = currentWeekStart()
  const weeks = [start, shiftWeek(start, 1), shiftWeek(start, 2), shiftWeek(start, 3)]
  const myShifts: Array<{
    id: string
    starts_at: string
    ends_at: string
    position_name: string
  }> = []
  for (const w of weeks) {
    const rows = await fetchMyShiftsForWeek(w)
    for (const r of rows) {
      myShifts.push({
        id: r.shift.id,
        starts_at: r.shift.starts_at,
        ends_at: r.shift.ends_at,
        position_name: r.shift.position?.name ?? 'Shift',
      })
    }
  }

  // Candidate targets: active users in my facility except me
  const { data: userResp } = await supabase.auth.getUser()
  const { data: users } = await supabase
    .from('users')
    .select('id, full_name, email')
    .eq('active', true)

  const candidates = ((users ?? []) as Array<{ id: string; full_name: string | null; email: string }>)
    .filter((u) => u.id !== userResp.user?.id)
    .map((u) => ({ id: u.id, label: u.full_name ?? u.email }))

  return (
    <main>
      <div className="text-sm">
        <Link href="/modules/scheduling/swaps" className="underline">← Swaps</Link>
      </div>
      <h1 className="text-xl font-semibold mt-2">Propose a swap</h1>
      <NewSwapClient myShifts={myShifts} candidates={candidates} />
    </main>
  )
}
