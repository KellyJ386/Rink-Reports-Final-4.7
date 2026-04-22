'use client'

import { useState } from 'react'

import {
  addItemAction,
  deactivateItemAction,
  reactivateItemAction,
  renameItemLabelAction,
  updateItemAction,
} from '../actions'

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
    const result = await addItemAction({
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

  // Semantic wrappers from Phase 2 Seam 2 — each writes a distinct audit_log
  // action so the audit reader sees "label renamed" vs. "deactivated" vs.
  // "sort reordered" instead of generic "updated".

  const handleLabelRename = async (id: string, newLabelValue: string) => {
    const result = await renameItemLabelAction(id, newLabelValue)
    if (!result.ok) setError(result.error)
    else window.location.reload()
  }

  const handleActiveToggle = async (id: string, active: boolean) => {
    const result = active
      ? await reactivateItemAction(id)
      : await deactivateItemAction(id)
    if (!result.ok) setError(result.error)
    else window.location.reload()
  }

  // Sort-order changes don't have a dedicated single-item server action (the
  // semantic wrapper is `reorderOptionListItems` which takes a full ordered
  // id list — a batch reorder UI is the natural follow-up). For now, the
  // generic update still fits for one-at-a-time bumps.
  const handleSortOrderChange = async (id: string, sortOrder: number) => {
    const result = await updateItemAction(id, { sort_order: sortOrder })
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
                      handleLabelRename(it.id, e.target.value.trim())
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
                      handleSortOrderChange(it.id, n)
                  }}
                  className="w-20"
                  aria-label="Sort order"
                />
                <label className="flex-row items-center gap-1 text-sm font-normal min-h-0">
                  <input
                    type="checkbox"
                    className="w-auto"
                    defaultChecked={it.is_active}
                    onChange={(e) => handleActiveToggle(it.id, e.target.checked)}
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
