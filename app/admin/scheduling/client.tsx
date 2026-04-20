'use client'

import { useState, useTransition } from 'react'

import { saveCutoffDaysAction, saveSwapApprovalModeAction } from './actions'

export function SchedulingSettingsClient({
  initialCutoffDays,
  initialSwapApprovalMode,
}: {
  initialCutoffDays: number
  initialSwapApprovalMode: 'manager_approval' | 'free'
}) {
  const [cutoff, setCutoff] = useState(initialCutoffDays)
  const [mode, setMode] = useState<'manager_approval' | 'free'>(initialSwapApprovalMode)
  const [cutoffStatus, setCutoffStatus] = useState<string | null>(null)
  const [modeStatus, setModeStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const saveCutoff = () => {
    setCutoffStatus(null)
    if (!Number.isFinite(cutoff) || cutoff < 1 || cutoff > 60) {
      setCutoffStatus('Enter a number between 1 and 60.')
      return
    }
    startTransition(async () => {
      const r = await saveCutoffDaysAction(cutoff)
      setCutoffStatus(r.ok ? 'Saved.' : `Error: ${r.error}`)
    })
  }

  const changeMode = (next: 'manager_approval' | 'free') => {
    setMode(next)
    setModeStatus(null)
    startTransition(async () => {
      const r = await saveSwapApprovalModeAction(next)
      setModeStatus(r.ok ? 'Saved.' : `Error: ${r.error}`)
    })
  }

  return (
    <section className="mt-10 space-y-6 max-w-xl">
      <div className="border rounded-md p-4">
        <label className="block">
          <span className="font-medium block">Availability cutoff (days ahead)</span>
          <span className="text-sm text-muted block mb-2">
            How many days in advance staff must submit availability. The daily
            availability-cutoff-reminder job nudges users who haven&rsquo;t submitted for
            weeks within this window. Set to 1–60; default 14.
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={60}
              value={cutoff}
              onChange={(e) => setCutoff(parseInt(e.target.value, 10) || 0)}
              className="border rounded px-3 py-1.5 w-32"
            />
            <button
              type="button"
              onClick={saveCutoff}
              disabled={pending}
              className="bg-accent text-white px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </label>
        {cutoffStatus ? <p className="mt-2 text-sm">{cutoffStatus}</p> : null}
      </div>

      <div className="border rounded-md p-4">
        <div className="font-medium">Swap approval mode</div>
        <p className="text-sm text-muted mt-1 mb-3">
          Controls whether manager approval is required after the target accepts a swap.
        </p>
        <div className="space-y-2">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="swap_mode"
              checked={mode === 'manager_approval'}
              onChange={() => changeMode('manager_approval')}
              disabled={pending}
              className="mt-1"
            />
            <span>
              <span className="font-medium block">Manager approval (default)</span>
              <span className="text-sm text-muted">
                Target accepts → waits in the manager queue → manager approves or denies →
                atomic reassignment.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="swap_mode"
              checked={mode === 'free'}
              onChange={() => changeMode('free')}
              disabled={pending}
              className="mt-1"
            />
            <span>
              <span className="font-medium block">Free mode</span>
              <span className="text-sm text-muted">
                Target accepts → reassignment happens immediately. No manager step. Use when
                you trust staff to resolve swaps among themselves.
              </span>
            </span>
          </label>
        </div>
        {modeStatus ? <p className="mt-2 text-sm">{modeStatus}</p> : null}
      </div>
    </section>
  )
}
