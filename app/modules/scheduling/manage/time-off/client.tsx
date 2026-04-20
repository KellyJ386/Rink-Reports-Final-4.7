'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import type { TimeOffRequest } from '@/lib/scheduling/types'

import { decideTimeOffAction } from '../../actions'

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function TimeOffQueueClient({
  requests,
  userLabels,
}: {
  requests: TimeOffRequest[]
  userLabels: Record<string, string>
}) {
  const router = useRouter()
  const [noteByReq, setNoteByReq] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()

  const decide = (id: string, decision: 'approved' | 'denied') => {
    startTransition(async () => {
      const r = await decideTimeOffAction(id, decision, noteByReq[id] || undefined)
      if (r.ok) router.refresh()
      else alert(r.error ?? 'Failed.')
    })
  }

  if (requests.length === 0) {
    return <p className="text-muted mt-6">No pending requests.</p>
  }

  return (
    <ul className="mt-6 divide-y border rounded-md max-w-2xl">
      {requests.map((r) => (
        <li key={r.id} className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="font-medium">{userLabels[r.user_id] ?? r.user_id.slice(0, 8)}</div>
              <div className="text-sm">
                {fmt(r.starts_at)} – {fmt(r.ends_at)}
              </div>
              {r.reason ? <div className="text-xs text-muted mt-1">{r.reason}</div> : null}
            </div>
          </div>
          <input
            type="text"
            value={noteByReq[r.id] ?? ''}
            onChange={(e) => setNoteByReq((prev) => ({ ...prev, [r.id]: e.target.value }))}
            placeholder="Decision note (optional)"
            className="w-full border rounded px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => decide(r.id, 'approved')}
              className="bg-green-600 text-white px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => decide(r.id, 'denied')}
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
