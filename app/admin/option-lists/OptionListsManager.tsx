'use client'

import Link from 'next/link'
import { useState } from 'react'

import { createListAction, deleteListAction } from './actions'

type ListRow = { id: string; slug: string; name: string; description: string | null; item_count: number }

export function OptionListsManager({ lists }: { lists: ListRow[] }) {
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [refs, setRefs] = useState<string[] | null>(null)
  const [pending, setPending] = useState(false)

  const handleCreate = async () => {
    setError(null)
    setPending(true)
    const result = await createListAction({ slug, name, description: description || undefined })
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    window.location.reload()
  }

  const handleDelete = async (id: string, label: string) => {
    if (!confirm(`Delete list "${label}"? This cannot be undone.`)) return
    setError(null)
    setRefs(null)
    const result = await deleteListAction(id)
    if (!result.ok) {
      setError(result.error)
      if ('references' in result && result.references) setRefs(result.references)
      return
    }
    window.location.reload()
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="border border-hairline rounded-md p-4">
        <h2 className="font-semibold mb-3">New list</h2>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-2">
          <label>
            Slug (plural snake_case)
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. hazards"
              className="font-mono"
            />
          </label>
          <label>
            Display name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Circle Check Hazards"
            />
          </label>
        </div>
        <label className="block mt-2">
          Description (optional)
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={handleCreate}
          disabled={pending || !slug || !name}
          className="mt-3"
        >
          {pending ? 'Creating…' : 'Create list'}
        </button>
        {error && (
          <p role="alert" className="text-danger text-sm mt-2">
            {error}
          </p>
        )}
        {refs && refs.length > 0 && (
          <div className="text-xs text-muted mt-1">
            Referenced by: {refs.join(', ')}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-3">All lists</h2>
        {lists.length === 0 ? (
          <p className="text-muted text-sm">None yet.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-muted">
                <th className="py-2 pr-3 font-medium">Slug</th>
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Items</th>
                <th className="py-2 pr-3" aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {lists.map((l) => (
                <tr key={l.id} className="border-b border-hairline">
                  <td className="py-2 pr-3 font-mono text-xs">{l.slug}</td>
                  <td className="py-2 pr-3">{l.name}</td>
                  <td className="py-2 pr-3">{l.item_count}</td>
                  <td className="py-2 pr-3">
                    <div className="flex gap-2">
                      <Link href={`/admin/option-lists/${l.id}`}>Edit items</Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(l.id, l.name)}
                        className="bg-transparent border border-danger text-danger px-2 py-1 rounded text-xs min-h-0"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
