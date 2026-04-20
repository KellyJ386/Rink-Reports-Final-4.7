'use client'

import { useState } from 'react'

import { createItemAction, updateItemAction } from '../actions'

type Item = {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
}

export function OptionListItemsEditor({
  optionListId,
  items,
}: {
  optionListId: string
  items: Item[]
}) {
  const [newKey, setNewKey] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleAdd = async () => {
    if (!newKey || !newLabel) return
    setError(null)
    const result = await createItemAction({
      option_list_id: optionListId,
      key: newKey,
      label: newLabel,
      sort_order: (items[items.length - 1]?.sort_order ?? 0) + 1,
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNewKey('')
    setNewLabel('')
    window.location.reload()
  }

  const handleUpdate = async (id: string, patch: Partial<Item>) => {
    const result = await updateItemAction(id, patch)
    if (!result.ok) setError(result.error)
    else window.location.reload()
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="border border-hairline rounded-md p-3">
        <h2 className="font-semibold mb-3">Add item</h2>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2">
          <label>
            Key (stable, immutable)
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="e.g. wet_floor"
              className="font-mono"
            />
          </label>
          <label>
            Label
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Wet floor"
            />
          </label>
          <button type="button" onClick={handleAdd} disabled={!newKey || !newLabel} className="self-end">
            Add
          </button>
        </div>
        {error && (
          <p role="alert" className="text-danger text-sm mt-2">
            {error}
          </p>
        )}
        <p className="text-xs text-muted mt-2">
          Once saved, a key cannot be changed (enforced by the database). To retire an option,
          uncheck "Active" — history references stay intact.
        </p>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Items</h2>
        {items.length === 0 ? (
          <p className="text-muted text-sm">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((it) => (
              <li
                key={it.id}
                className="border border-hairline rounded-md p-3 flex items-center gap-3 flex-wrap"
              >
                <code className="text-xs text-muted font-mono w-32 flex-shrink-0 break-all">
                  {it.key}
                </code>
                <input
                  type="text"
                  defaultValue={it.label}
                  onBlur={(e) => {
                    if (e.target.value !== it.label && e.target.value.trim()) {
                      handleUpdate(it.id, { label: e.target.value.trim() })
                    }
                  }}
                  className="flex-1 min-w-[150px]"
                />
                <input
                  type="number"
                  defaultValue={it.sort_order}
                  min={0}
                  step={1}
                  onBlur={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n) && n !== it.sort_order)
                      handleUpdate(it.id, { sort_order: n })
                  }}
                  className="w-20"
                  aria-label="Sort order"
                />
                <label className="flex-row items-center gap-1 text-sm font-normal min-h-0">
                  <input
                    type="checkbox"
                    className="w-auto"
                    defaultChecked={it.is_active}
                    onChange={(e) => handleUpdate(it.id, { is_active: e.target.checked })}
                  />
                  Active
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
