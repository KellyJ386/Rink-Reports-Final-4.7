'use client'

import { useState } from 'react'

import { createFacilityAction } from './actions'

export function CreateFacilityClient() {
  const [name, setName] = useState('')
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ facility_id: string; invite_url: string } | null>(null)

  const handleCreate = async () => {
    setPending(true)
    setError(null)
    try {
      const r = await createFacilityAction({
        name,
        address: {
          street,
          city,
          state,
          postal_code: postalCode,
        },
        firstAdminEmail: email,
      })
      setResult(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    }
    setPending(false)
  }

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* noop */
    }
  }

  if (result) {
    return (
      <div className="max-w-2xl border border-emerald-300 bg-emerald-50 rounded-md p-4">
        <h2 className="font-semibold">Facility created</h2>
        <p className="text-sm text-muted mt-1">
          Send this link to the first admin. It expires in 7 days and is single-use.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="text-xs break-all flex-1">{result.invite_url}</code>
          <button
            type="button"
            onClick={() => copy(result.invite_url)}
            className="bg-emerald-600 text-white px-3 py-1 rounded text-xs min-h-0"
          >
            Copy
          </button>
        </div>
        <div className="mt-3 text-xs text-muted">
          Facility ID: <code>{result.facility_id}</code>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl flex flex-col gap-3">
      <label>
        Facility name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Rink XYZ" />
      </label>
      <label>
        Street
        <input type="text" value={street} onChange={(e) => setStreet(e.target.value)} />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label>
          City
          <input type="text" value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        <label>
          State / Prov.
          <input type="text" value={state} onChange={(e) => setState(e.target.value)} />
        </label>
        <label>
          Postal code
          <input type="text" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
        </label>
      </div>
      <label>
        First admin email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {error && <p role="alert" className="text-danger text-sm">{error}</p>}
      <button
        type="button"
        onClick={handleCreate}
        disabled={pending || !name || !postalCode || !email}
        className="self-start"
      >
        {pending ? 'Creating…' : 'Create facility'}
      </button>
    </div>
  )
}
