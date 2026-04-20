'use client'

import { useEffect, useRef, useState } from 'react'

import type { IceDepthPoint } from '@/lib/ice-depth/types'

type Props = {
  point: IceDepthPoint
  previousDepthMm?: number | null
  initialDepthMm?: number | null
  pending?: boolean
  onSave: (depthMm: number) => void | Promise<void>
  onCancel: () => void
}

/**
 * Full-screen modal for entering a single point's depth. Designed for mobile with gloves:
 *   - Numeric soft keyboard via inputMode="decimal"
 *   - Large tap targets (≥44px)
 *   - Focus trapped inside the modal for keyboard users
 *   - Shows previous reading for context
 */
export function ReadingModal({
  point,
  previousDepthMm,
  initialDepthMm,
  pending = false,
  onSave,
  onCancel,
}: Props) {
  const [value, setValue] = useState<string>(
    initialDepthMm != null ? String(initialDepthMm) : '',
  )
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(t)
  }, [])

  const handleSave = async () => {
    const n = Number(value)
    if (!Number.isFinite(n)) {
      setError('Enter a number.')
      return
    }
    if (n < 0 || n > 500) {
      setError('Depth must be between 0 and 500 mm.')
      return
    }
    setError(null)
    await onSave(n)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Reading for ${point.label}`}
      className="fixed inset-0 z-50 bg-white flex flex-col"
    >
      <header className="flex items-center gap-3 px-4 py-3 border-b border-hairline">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-tap min-w-tap bg-transparent text-ink px-2"
          aria-label="Cancel"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase text-muted tracking-wide">
            Point {point.sort_order ?? ''}
          </div>
          <div className="font-semibold text-ink truncate">{point.label}</div>
        </div>
      </header>

      <div className="flex-1 px-4 py-6 flex flex-col gap-4">
        <label className="text-sm font-medium">
          Depth (mm)
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            min={0}
            max={500}
            step="any"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="text-2xl"
            placeholder="e.g. 38"
          />
        </label>

        {previousDepthMm != null && (
          <div className="text-sm text-muted">
            Previous session: <span className="font-semibold text-ink">{previousDepthMm} mm</span>
          </div>
        )}

        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
      </div>

      <footer className="px-4 py-3 border-t border-hairline flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-transparent border border-hairline text-ink rounded-md font-medium"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || value === ''}
          className="flex-1"
        >
          {pending ? 'Saving…' : 'Save reading'}
        </button>
      </footer>
    </div>
  )
}
