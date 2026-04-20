import Link from 'next/link'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { fetchMyTimeOffRequests } from '@/lib/scheduling/time-off'

import { TimeOffClient } from './client'

export default async function TimeOffPage() {
  await requireModuleEnabled('scheduling')
  const requests = await fetchMyTimeOffRequests()

  return (
    <main>
      <div className="text-sm">
        <Link href="/modules/scheduling" className="underline">← My schedule</Link>
      </div>
      <h1 className="text-xl font-semibold mt-2">Time off</h1>
      <p className="text-muted text-sm mt-1">
        Request days off. Submitted requests go to your manager for approval.
      </p>
      <TimeOffClient requests={requests} />
    </main>
  )
}
