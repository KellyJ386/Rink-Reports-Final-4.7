'use client'

import { useState, useTransition } from 'react'

import { saveDefaultExpiryDaysAction, saveRequireAckAction } from './actions'

export function CommunicationsSettingsClient({
  initialRequireAck,
  initialDefaultExpiryDays,
}: {
  initialRequireAck: boolean
  initialDefaultExpiryDays: number
}) {
  const [requireAck, setRequireAck] = useState(initialRequireAck)
  const [expiryDays, setExpiryDays] = useState(initialDefaultExpiryDays)
  const [ackStatus, setAckStatus] = useState<string | null>(null)
  const [expiryStatus, setExpiryStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const toggleAck = (next: boolean) => {
    setRequireAck(next)
    setAckStatus(null)
    startTransition(async () => {
      const r = await saveRequireAckAction(next)
      setAckStatus(r.ok ? 'Saved.' : `Error: ${r.error}`)
    })
  }

  const saveExpiry = () => {
    setExpiryStatus(null)
    if (!Number.isFinite(expiryDays) || expiryDays < 1 || expiryDays > 365) {
      setExpiryStatus('Enter a number between 1 and 365.')
      return
    }
    startTransition(async () => {
      const r = await saveDefaultExpiryDaysAction(expiryDays)
      setExpiryStatus(r.ok ? 'Saved.' : `Error: ${r.error}`)
    })
  }

  return (
    <section className="mt-10 space-y-6 max-w-xl">
      <div className="border rounded-md p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={requireAck}
            onChange={(e) => toggleAck(e.target.checked)}
            disabled={pending}
            className="mt-1"
          />
          <span>
            <span className="font-medium block">
              Allow &ldquo;requires acknowledgment&rdquo; announcements
            </span>
            <span className="text-sm text-muted">
              When enabled, authors can check the &ldquo;requires acknowledgment&rdquo; box on new
              announcements and track who has acked. Disable to hide the option entirely; existing
              announcements keep their per-post setting.
            </span>
          </span>
        </label>
        {ackStatus ? <p className="mt-2 text-sm">{ackStatus}</p> : null}
      </div>

      <div className="border rounded-md p-4">
        <label className="block">
          <span className="font-medium block">Default expiry window (days)</span>
          <span className="text-sm text-muted block mb-2">
            Announcements posted without an explicit expiry date are auto-hidden after this many
            days. Set to 1–365.
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={365}
              value={expiryDays}
              onChange={(e) => setExpiryDays(parseInt(e.target.value, 10) || 0)}
              className="border rounded px-3 py-1.5 w-32"
            />
            <button
              type="button"
              onClick={saveExpiry}
              disabled={pending}
              className="bg-accent text-white px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </label>
        {expiryStatus ? <p className="mt-2 text-sm">{expiryStatus}</p> : null}
      </div>
    </section>
  )
}
