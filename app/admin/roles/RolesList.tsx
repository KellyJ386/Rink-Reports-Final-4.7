'use client'

import Link from 'next/link'
import { useState } from 'react'

import { createRoleAction, deleteRoleAction } from './actions'

type Role = {
  id: string
  name: string
  description: string | null
  is_system: boolean
  user_count: number
}

export function RolesList({ roles }: { roles: Role[] }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const handleCreate = async () => {
    if (!name) return
    setError(null)
    setPending(true)
    const result = await createRoleAction(name, desc || undefined)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    window.location.reload()
  }

  const handleDelete = async (roleId: string) => {
    if (!confirm('Delete this role? Users assigned to it must be moved first.')) return
    const result = await deleteRoleAction(roleId)
    if (!result.ok) {
      alert(result.error)
      return
    }
    window.location.reload()
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="border border-hairline rounded-md p-4">
        <h2 className="font-semibold mb-3">New role</h2>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2">
          <label>
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              placeholder="e.g. Weekend Manager"
            />
          </label>
          <label>
            Description (optional)
            <input
              type="text"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Short summary of what this role does"
            />
          </label>
          <button type="button" onClick={handleCreate} disabled={pending || !name} className="self-end">
            {pending ? 'Creating…' : 'Create role'}
          </button>
        </div>
        {error && (
          <p role="alert" className="text-danger text-sm mt-2">
            {error}
          </p>
        )}
        <p className="text-xs text-muted mt-2">
          The new role will have no access on any module. Set module access in the role detail.
        </p>
      </section>

      <section>
        <h2 className="font-semibold mb-3">All roles</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-muted">
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Description</th>
              <th className="py-2 pr-3 font-medium">Users</th>
              <th className="py-2 pr-3 font-medium">System?</th>
              <th className="py-2 pr-3" aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id} className="border-b border-hairline">
                <td className="py-2 pr-3">{r.name}</td>
                <td className="py-2 pr-3 text-muted">{r.description ?? '—'}</td>
                <td className="py-2 pr-3">{r.user_count}</td>
                <td className="py-2 pr-3">{r.is_system ? 'Yes' : '—'}</td>
                <td className="py-2 pr-3">
                  <div className="flex gap-2">
                    <Link href={`/admin/roles/${r.id}`} className="text-sm">
                      Edit access
                    </Link>
                    {!r.is_system && (
                      <button
                        type="button"
                        onClick={() => handleDelete(r.id)}
                        className="bg-transparent border border-danger text-danger px-2 py-1 rounded text-xs min-h-0"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
