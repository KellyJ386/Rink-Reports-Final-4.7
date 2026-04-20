'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { proposeSwapAction } from '../../actions'

type Shift = {
  id: string
  starts_at: string
  ends_at: string
  position_name: string
}

type Candidate = { id: string; label: string }

function fmtShift(s: Shift) {
  const d = new Date(s.starts_at)
  return `${s.position_name} — ${d.toLocaleDateString()} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

export function NewSwapClient({
  myShifts,
  candidates,
}: {
  myShifts: Shift[]
  candidates: Candidate[]
}) {
  const router = useRouter()
  const [requesterShiftId, setRequesterShiftId] = useState(myShifts[0]?.id ?? '')
  const [targetUserId, setTargetUserId] = useState(candidates[0]?.id ?? '')
  const [targetShiftId, setTargetShiftId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const idempotencyKey = useMemo(
    () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    [],
  )

  const submit = () => {
    setError(null)
    if (!requesterShiftId || !targetUserId) {
      setError('Pick a shift and a target user.')
      return
    }
    startTransition(async () => {
      const r = await proposeSwapAction({
        requester_shift_id: requesterShiftId,
        target_user_id: targetUserId,
        target_shift_id: targetShiftId || null,
        idempotency_key: idempotencyKey,
      })
      if (r.ok) router.push('/modules/scheduling/swaps')
      else setError(r.error)
    })
  }

  if (myShifts.length === 0) {
    return (
      <p className="text-muted mt-4">
        You don&rsquo;t have any upcoming shifts to swap.
      </p>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="mt-4 max-w-xl space-y-3"
    >
      <div>
        <label className="block text-sm font-medium">Your shift</label>
        <select
          value={requesterShiftId}
          onChange={(e) => setRequesterShiftId(e.target.value)}
          className="mt-1 border rounded-md px-3 py-2 w-full"
        >
          {myShifts.map((s) => (
            <option key={s.id} value={s.id}>
              {fmtShift(s)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium">Target colleague</label>
        <select
          value={targetUserId}
          onChange={(e) => setTargetUserId(e.target.value)}
          className="mt-1 border rounded-md px-3 py-2 w-full"
        >
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium">
          Their shift to swap with (optional — leave blank for a giveaway)
        </label>
        <input
          type="text"
          value={targetShiftId}
          onChange={(e) => setTargetShiftId(e.target.value)}
          placeholder="Paste a shift ID from their schedule"
          className="mt-1 border rounded-md px-3 py-2 w-full"
        />
        <p className="text-xs text-muted mt-1">
          V1 simplification: you supply the shift ID manually. Agent 9 may add a richer picker later.
        </p>
      </div>

      {error ? <p className="text-red-700 text-sm">{error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-white px-4 py-2 rounded-md font-medium disabled:opacity-50"
      >
        {pending ? 'Proposing…' : 'Propose swap'}
      </button>
    </form>
  )
}
