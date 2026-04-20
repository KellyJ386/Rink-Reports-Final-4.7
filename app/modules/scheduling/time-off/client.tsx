'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import type { TimeOffRequest } from '@/lib/scheduling/types'

import { submitTimeOffAction, withdrawTimeOffAction } from '../actions'

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function statusPill(status: TimeOffRequest['status']) {
  const classes: Record<TimeOffRequest['status'], string> = {
    pending: 'bg-amber-100 text-amber-900 border-amber-300',
    approved: 'bg-green-100 text-green-900 border-green-300',
    denied: 'bg-red-100 text-red-900 border-red-300',
    withdrawn: 'bg-slate-100 text-slate-700 border-slate-300',
  }
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded border ${classes[status]}`}>
      {status}
    </span>
  )
}

export function TimeOffClient({ requests }: { requests: TimeOffRequest[] }) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [starts, setStarts] = useState('')
  const [ends, setEnds] = useState('')
  const [reason, setReason] = useState('')
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
    if (!starts || !ends) {
      setError('Please provide both start and end dates.')
      return
    }
    startTransition(async () => {
      const r = await submitTimeOffAction({
        starts_at: new Date(starts).toISOString(),
        ends_at: new Date(ends).toISOString(),
        reason: reason || undefined,
        idempotency_key: idempotencyKey,
      })
      if (r.ok) {
        setShowForm(false)
        setStarts('')
        setEnds('')
        setReason('')
        router.refresh()
      } else {
        setError(r.error)
      }
    })
  }

  const withdraw = (id: string) => {
    if (!confirm('Withdraw this request? If it was already approved, the schedule will NOT be auto-reverted.')) return
    startTransition(async () => {
      const r = await withdrawTimeOffAction(id)
      if (r.ok) router.refresh()
      else setError(r.error ?? 'Failed to withdraw.')
    })
  }

  return (
    <div className="mt-4 max-w-2xl">
      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="bg-accent text-white px-4 py-2 rounded-md font-medium"
        >
          + Request time off
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="border rounded-md p-4 space-y-3"
        >
          <div>
            <label className="block text-sm font-medium">Start</label>
            <input
              type="datetime-local"
              value={starts}
              onChange={(e) => setStarts(e.target.value)}
              className="mt-1 border rounded-md px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium">End</label>
            <input
              type="datetime-local"
              value={ends}
              onChange={(e) => setEnds(e.target.value)}
              className="mt-1 border rounded-md px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="mt-1 w-full border rounded-md px-3 py-2"
            />
          </div>
          {error ? <p className="text-red-700 text-sm">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="bg-accent text-white px-4 py-2 rounded-md font-medium disabled:opacity-50"
            >
              {pending ? 'Submitting…' : 'Submit'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="underline text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="mt-6 divide-y border rounded-md">
        {requests.length === 0 ? (
          <li className="p-4 text-muted text-sm">No requests yet.</li>
        ) : (
          requests.map((r) => (
            <li key={r.id} className="p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="text-sm">
                    {fmt(r.starts_at)} – {fmt(r.ends_at)}
                  </div>
                  {r.reason ? (
                    <div className="text-xs text-muted mt-1">{r.reason}</div>
                  ) : null}
                  {r.decision_note ? (
                    <div className="text-xs mt-1">Note: {r.decision_note}</div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {statusPill(r.status)}
                  {(r.status === 'pending' || r.status === 'approved') ? (
                    <button
                      type="button"
                      onClick={() => withdraw(r.id)}
                      className="text-sm underline text-red-700"
                    >
                      Withdraw
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
