'use client'

import Link from 'next/link'
import { useState } from 'react'

import { createResourceAction, updateResourceAction } from './actions'

type Resource = {
  id: string
  resource_type: string
  name: string
  sort_order: number
  is_active: boolean
}

type TypeInfo = { type: string; label: string; description: string }

export function ResourcesTabs({
  types,
  activeType,
  resources,
}: {
  types: TypeInfo[]
  activeType: string
  resources: Resource[]
}) {
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeInfo = types.find((t) => t.type === activeType)!

  const handleCreate = async () => {
    if (!name) return
    setError(null)
    setPending(true)
    const result = await createResourceAction({ resource_type: activeType, name })
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    window.location.reload()
  }

  const handleUpdate = async (id: string, patch: Partial<Resource>) => {
    const result = await updateResourceAction(id, patch)
    if (!result.ok) setError(result.error)
    else window.location.reload()
  }

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap border-b border-hairline">
        {types.map((t) => (
          <Link
            key={t.type}
            href={`/admin/resources?type=${t.type}`}
            aria-current={t.type === activeType ? 'page' : undefined}
            className={
              'no-underline py-2 px-3 text-sm ' +
              (t.type === activeType
                ? 'border-b-2 border-accent font-semibold text-ink'
                : 'text-muted')
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <p className="text-sm text-muted">{activeInfo.description}</p>

      <section className="border border-hairline rounded-md p-3">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
          <label>
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`Add a ${activeInfo.label.toLowerCase().slice(0, -1)}`}
            />
          </label>
          <button type="button" onClick={handleCreate} disabled={!name || pending} className="self-end">
            {pending ? 'Adding…' : 'Add'}
          </button>
        </div>
        {error && (
          <p role="alert" className="text-danger text-sm mt-2">
            {error}
          </p>
        )}
      </section>

      <section>
        <h3 className="font-semibold mb-2">{activeInfo.label}</h3>
        {resources.length === 0 ? (
          <p className="text-muted text-sm">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {resources.map((r) => (
              <li
                key={r.id}
                className="border border-hairline rounded-md p-3 flex items-center gap-3 flex-wrap"
              >
                <input
                  type="text"
                  defaultValue={r.name}
                  onBlur={(e) => {
                    if (e.target.value !== r.name && e.target.value.trim()) {
                      handleUpdate(r.id, { name: e.target.value.trim() })
                    }
                  }}
                  className="flex-1 min-w-0"
                />
                <input
                  type="number"
                  defaultValue={r.sort_order}
                  min={0}
                  step={1}
                  onBlur={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n) && n !== r.sort_order) handleUpdate(r.id, { sort_order: n })
                  }}
                  className="w-20"
                  aria-label="Sort order"
                />
                <label className="flex-row items-center gap-1 text-sm font-normal min-h-0">
                  <input
                    type="checkbox"
                    className="w-auto"
                    defaultChecked={r.is_active}
                    onChange={(e) => handleUpdate(r.id, { is_active: e.target.checked })}
                  />
                  Active
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted mt-2">
          Resources cannot be deleted — deactivating hides them from new submissions while preserving
          history references. See ADMIN.md &gt; "Soft-delete is the model."
        </p>
      </section>
    </div>
  )
}
