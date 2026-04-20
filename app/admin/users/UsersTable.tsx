'use client'

import { useState, useTransition } from 'react'

import { changeUserRoleAction, deactivateUserAction, reactivateUserAction } from './actions'

type User = {
  id: string
  full_name: string
  email: string
  active: boolean
  created_at: string
  roles: { id: string; name: string }[]
}

type Role = { id: string; name: string }

type Props = {
  users: User[]
  availableRoles: Role[]
}

export function UsersTable({ users, availableRoles }: Props) {
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const handleAction = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null)
    const result = await action()
    if (!result.ok) setError(result.error ?? 'Action failed')
    else startTransition(() => window.location.reload())
  }

  return (
    <div>
      {error && (
        <p role="alert" className="text-danger text-sm mb-3">
          {error}
        </p>
      )}
      <div className="overflow-x-auto hidden md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-muted">
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Email</th>
              <th className="py-2 pr-3 font-medium">Role</th>
              <th className="py-2 pr-3 font-medium">Active</th>
              <th className="py-2 pr-3" aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const currentRoleId = u.roles[0]?.id ?? ''
              const expanded = expandedUserId === u.id
              return (
                <tr key={u.id} className="border-b border-hairline align-top">
                  <td className="py-2 pr-3">{u.full_name || <span className="text-muted">—</span>}</td>
                  <td className="py-2 pr-3 break-all">{u.email}</td>
                  <td className="py-2 pr-3">
                    <select
                      defaultValue={currentRoleId}
                      onChange={async (e) => {
                        await handleAction(() => changeUserRoleAction(u.id, e.target.value))
                      }}
                    >
                      {availableRoles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    {u.active ? (
                      <span className="text-ok">Yes</span>
                    ) : (
                      <span className="text-danger">No</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {u.active ? (
                      <button
                        type="button"
                        className="bg-transparent border border-danger text-danger px-3 py-1 rounded text-xs min-h-0"
                        onClick={() => setExpandedUserId(expanded ? null : u.id)}
                      >
                        Deactivate…
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="bg-transparent border border-hairline text-ink px-3 py-1 rounded text-xs min-h-0"
                        onClick={() => handleAction(() => reactivateUserAction(u.id))}
                      >
                        Reactivate
                      </button>
                    )}
                    {expanded && u.active && (
                      <DeactivateConfirm
                        onCancel={() => setExpandedUserId(null)}
                        onConfirm={(reason) =>
                          handleAction(() => deactivateUserAction(u.id, reason))
                        }
                      />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden flex flex-col gap-3">
        {users.map((u) => (
          <div key={u.id} className="border border-hairline rounded-md p-3">
            <div className="font-medium">{u.full_name || u.email}</div>
            <div className="text-xs text-muted break-all">{u.email}</div>
            <div className="text-xs mt-1">
              Role: {u.roles[0]?.name ?? '—'} · {u.active ? 'Active' : 'Inactive'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DeactivateConfirm({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="mt-2 p-2 border border-danger rounded bg-red-50 text-xs">
      <label className="text-xs font-medium">
        Reason (optional)
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1"
          placeholder="e.g. no longer employed"
        />
      </label>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="bg-danger text-white px-3 py-1 rounded text-xs min-h-0"
          onClick={() => onConfirm(reason)}
        >
          Deactivate + sign out
        </button>
        <button
          type="button"
          className="bg-transparent border border-hairline text-ink px-3 py-1 rounded text-xs min-h-0"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
