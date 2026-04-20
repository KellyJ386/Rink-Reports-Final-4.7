'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

import type { ShiftSwapRequest } from '@/lib/scheduling/types'

import { acceptSwapAction, withdrawSwapAction } from '../actions'

function statusPill(status: ShiftSwapRequest['status']) {
  const classes: Record<ShiftSwapRequest['status'], string> = {
    pending_target: 'bg-amber-100 text-amber-900 border-amber-300',
    pending_manager: 'bg-sky-100 text-sky-900 border-sky-300',
    approved: 'bg-green-100 text-green-900 border-green-300',
    denied: 'bg-red-100 text-red-900 border-red-300',
    withdrawn: 'bg-slate-100 text-slate-700 border-slate-300',
  }
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded border ${classes[status]}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

export function SwapsClient({
  swaps,
  currentUserId,
}: {
  swaps: ShiftSwapRequest[]
  currentUserId: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const accept = (id: string) => {
    startTransition(async () => {
      const r = await acceptSwapAction(id)
      if (r.ok) router.refresh()
      else alert(r.error)
    })
  }

  const withdraw = (id: string) => {
    if (!confirm('Withdraw this swap?')) return
    startTransition(async () => {
      const r = await withdrawSwapAction(id)
      if (r.ok) router.refresh()
      else alert(r.error ?? 'Failed.')
    })
  }

  return (
    <div className="mt-4 max-w-2xl">
      <Link
        href="/modules/scheduling/swaps/new"
        className="inline-block bg-accent text-white px-4 py-2 rounded-md font-medium no-underline"
      >
        + Propose swap
      </Link>

      <ul className="mt-6 divide-y border rounded-md">
        {swaps.length === 0 ? (
          <li className="p-4 text-muted text-sm">No swap requests.</li>
        ) : (
          swaps.map((s) => {
            const iAmRequester = s.requester_user_id === currentUserId
            const iAmTarget = s.target_user_id === currentUserId
            const canAccept = iAmTarget && s.status === 'pending_target'
            const canWithdraw =
              (iAmRequester || iAmTarget) &&
              s.status !== 'approved' &&
              s.status !== 'denied' &&
              s.status !== 'withdrawn'
            return (
              <li key={s.id} className="p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="text-sm">
                      {iAmRequester ? 'You → ' : 'From someone → '}
                      {iAmTarget ? 'you' : 'colleague'}
                    </div>
                    <div className="text-xs text-muted">
                      Created {new Date(s.created_at).toLocaleString()}
                    </div>
                    {s.decision_note ? (
                      <div className="text-xs mt-1">Note: {s.decision_note}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {statusPill(s.status)}
                    {canAccept ? (
                      <button
                        type="button"
                        onClick={() => accept(s.id)}
                        disabled={pending}
                        className="text-sm underline"
                      >
                        Accept
                      </button>
                    ) : null}
                    {canWithdraw ? (
                      <button
                        type="button"
                        onClick={() => withdraw(s.id)}
                        disabled={pending}
                        className="text-sm underline text-red-700"
                      >
                        Withdraw
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
