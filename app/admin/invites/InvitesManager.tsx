'use client'

import { useState } from 'react'

import { createInviteAction, resendInviteAction, revokeInviteAction } from './actions'

type InviteRow = {
  id: string
  email: string
  role_name: string
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
  created_at: string
}

type Role = { id: string; name: string }

export function InvitesManager({ invites, roles }: { invites: InviteRow[]; roles: Role[] }) {
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '')
  const [lastUrl, setLastUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const handleInvite = async () => {
    setError(null)
    setLastUrl(null)
    if (!email || !roleId) return
    setPending(true)
    const result = await createInviteAction({ email, roleId })
    setPending(false)
    if (!result) return
    if ('invite_url' in result) {
      setLastUrl(result.invite_url)
      setEmail('')
      window.location.reload()
      return
    }
    setError('Invite failed')
  }

  const handleRevoke = async (id: string) => {
    await revokeInviteAction(id)
    window.location.reload()
  }

  const handleResend = async (id: string) => {
    const result = await resendInviteAction(id)
    if (result.ok) {
      setLastUrl(result.invite_url)
      window.location.reload()
    } else {
      setError(result.error)
    }
  }

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* clipboard unavailable; user can select manually */
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="border border-hairline rounded-md p-4">
        <h2 className="font-semibold mb-3">Invite user</h2>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_200px_auto] gap-2">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </label>
          <label>
            Role
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleInvite}
            disabled={pending || !email || !roleId}
            className="self-end"
          >
            {pending ? 'Sending…' : 'Send invite'}
          </button>
        </div>

        {error && (
          <p role="alert" className="text-danger text-sm mt-2">
            {error}
          </p>
        )}
        {lastUrl && (
          <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded text-sm">
            <div className="font-medium">Invite created. Share this link:</div>
            <div className="flex items-center gap-2 mt-1">
              <code className="break-all text-xs flex-1">{lastUrl}</code>
              <button
                type="button"
                onClick={() => copy(lastUrl)}
                className="bg-transparent border border-emerald-400 text-emerald-800 px-2 py-1 rounded text-xs min-h-0"
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-3">All invites</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-muted">
                <th className="py-2 pr-3 font-medium">Email</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Expires</th>
                <th className="py-2 pr-3" aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {invites.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-muted text-sm">
                    No invites yet.
                  </td>
                </tr>
              )}
              {invites.map((i) => {
                const state: string =
                  i.accepted_at ? 'Accepted'
                  : i.revoked_at ? 'Revoked'
                  : new Date(i.expires_at) < new Date() ? 'Expired'
                  : 'Outstanding'
                return (
                  <tr key={i.id} className="border-b border-hairline">
                    <td className="py-2 pr-3 break-all">{i.email}</td>
                    <td className="py-2 pr-3">{i.role_name}</td>
                    <td className="py-2 pr-3">{state}</td>
                    <td className="py-2 pr-3">{new Date(i.expires_at).toLocaleDateString()}</td>
                    <td className="py-2 pr-3">
                      {state === 'Outstanding' && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleResend(i.id)}
                            className="bg-transparent border border-hairline text-ink px-2 py-1 rounded text-xs min-h-0"
                          >
                            Resend
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevoke(i.id)}
                            className="bg-transparent border border-danger text-danger px-2 py-1 rounded text-xs min-h-0"
                          >
                            Revoke
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
