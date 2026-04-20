'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import type { ShiftSwapRequest } from '@/lib/scheduling/types'

import { managerDecideSwapAction } from '../../actions'

export function SwapQueueClient({ swaps }: { swaps: ShiftSwapRequest[] }) {
  const router = useRouter()
  const [noteById, setNoteById] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()

  const decide = (id: string, decision: 'approved' | 'denied') => {
    startTransition(async () => {
      const r = await managerDecideSwapAction(id, decision, noteById[id] || undefined)
      if (r.ok) router.refresh()
      else alert(r.error ?? 'Failed.')
    })
  }

  if (swaps.length === 0) {
    return <p className="text-muted mt-6">No swaps waiting on your approval.</p>
  }

  return (
    <ul className="mt-6 divide-y border rounded-md max-w-2xl">
      {swaps.map((s) => (
        <li key={s.id} className="p-4 space-y-2">
          <div className="text-sm">
            Requester {s.requester_user_id.slice(0, 8)}… → Target {s.target_user_id.slice(0, 8)}…
          </div>
          <div className="text-xs text-muted">
            Target accepted{' '}
            {s.target_response_at ? new Date(s.target_response_at).toLocaleString() : 'recently'}
          </div>
          <input
            type="text"
            value={noteById[s.id] ?? ''}
            onChange={(e) => setNoteById((prev) => ({ ...prev, [s.id]: e.target.value }))}
            placeholder="Decision note (optional)"
            className="w-full border rounded px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => decide(s.id, 'approved')}
              className="bg-green-600 text-white px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
            >
              Approve &amp; reassign
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => decide(s.id, 'denied')}
              className="bg-red-600 text-white px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
            >
              Deny
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
