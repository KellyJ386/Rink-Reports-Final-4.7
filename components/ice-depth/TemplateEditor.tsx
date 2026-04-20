'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { RINK_SVGS } from '@/app/modules/ice-depth/svgs'
import type { IceDepthPoint, SvgKey } from '@/lib/ice-depth/types'

import { SvgRink, type PointWithState } from './SvgRink'

type Props = {
  templateId: string
  initial: {
    name: string
    svg_key: SvgKey
    current_points: IceDepthPoint[]
    draft_points: IceDepthPoint[] | null
    version: number
  }
  onSaveDraft: (input: {
    template_id: string
    draft_points?: IceDepthPoint[]
    name?: string
    svg_key?: SvgKey
  }) => Promise<{ ok: true } | { ok: false; error: string }>
  onPublish: (
    templateId: string,
  ) => Promise<{ ok: true; new_version: number } | { ok: false; error: string }>
  onDiscardDraft: (templateId: string) => Promise<{ ok: true } | { ok: false; error: string }>
}

/**
 * Admin template editor. Click the SVG to add a point; click a point to edit or
 * delete; drag via the list below to reposition (Agent 6 can add richer
 * interactions later; v1 keeps it functional).
 */
export function TemplateEditor({
  templateId,
  initial,
  onSaveDraft,
  onPublish,
  onDiscardDraft,
}: Props) {
  const router = useRouter()
  const [name, setName] = useState(initial.name)
  const [svgKey, setSvgKey] = useState<SvgKey>(initial.svg_key)
  const [points, setPoints] = useState<IceDepthPoint[]>(
    initial.draft_points ?? initial.current_points,
  )
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'saving' | 'publishing' | 'discarding' | null>(null)

  const selected = selectedKey ? points.find((p) => p.key === selectedKey) : null

  const addPointAt = (xPct: number, yPct: number) => {
    const nextOrder = (points.reduce((m, p) => Math.max(m, p.sort_order), 0) || 0) + 1
    const nextKey = `p${nextOrder}`
    setPoints([
      ...points,
      { key: nextKey, label: `Point ${nextOrder}`, x_pct: xPct, y_pct: yPct, sort_order: nextOrder },
    ])
    setSelectedKey(nextKey)
  }

  const updateSelected = (changes: Partial<IceDepthPoint>) => {
    if (!selected) return
    setPoints(points.map((p) => (p.key === selected.key ? { ...p, ...changes } : p)))
  }

  const deleteSelected = () => {
    if (!selected) return
    setPoints(points.filter((p) => p.key !== selected.key))
    setSelectedKey(null)
  }

  const onSvgClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only add a point if the click landed on empty SVG space (the svg itself or
    // its background rect), not on an existing point circle.
    const target = e.target as Element
    if (target.tagName !== 'svg' && target.tagName !== 'rect') return
    // Find the inner SVG to use as the reference frame for percentage coords
    const svg = target.closest('svg')
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    addPointAt(Math.round(x * 10) / 10, Math.round(y * 10) / 10)
  }

  const pointsWithState: PointWithState[] = points.map((p) => ({
    ...p,
    state: selectedKey === p.key ? 'selected' : 'empty',
  }))

  const handleSaveDraft = async () => {
    setError(null)
    setBusy('saving')
    const result = await onSaveDraft({
      template_id: templateId,
      draft_points: points,
      name,
      svg_key: svgKey,
    })
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  const handlePublish = async () => {
    setError(null)
    setBusy('publishing')
    // Save first so draft is current, then publish
    const save = await onSaveDraft({
      template_id: templateId,
      draft_points: points,
      name,
      svg_key: svgKey,
    })
    if (!save.ok) {
      setBusy(null)
      setError(save.error)
      return
    }
    const result = await onPublish(templateId)
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  const handleDiscard = async () => {
    setError(null)
    setBusy('discarding')
    const result = await onDiscardDraft(templateId)
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPoints(initial.current_points)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className="md:col-span-2">
          Template name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
        </label>
        <label>
          Rink backdrop
          <select value={svgKey} onChange={(e) => setSvgKey(e.target.value as SvgKey)}>
            {(Object.keys(RINK_SVGS) as SvgKey[]).map((k) => (
              <option key={k} value={k}>
                {RINK_SVGS[k].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div onClick={onSvgClick}>
        <SvgRink
          svgKey={svgKey}
          points={pointsWithState}
          onPointTap={(p) => setSelectedKey(p.key)}
          className="border border-hairline rounded-md bg-white cursor-crosshair"
        />
      </div>

      <p className="text-xs text-muted">Click empty space on the rink to add a point. Click an existing point to edit.</p>

      {selected && (
        <section className="border border-accent rounded-md p-3 bg-sky-50">
          <h3 className="font-semibold text-sm">Edit point {selected.sort_order}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            <label>
              Label
              <input
                type="text"
                value={selected.label}
                onChange={(e) => updateSelected({ label: e.target.value })}
              />
            </label>
            <label>
              Sort order
              <input
                type="number"
                min={1}
                step={1}
                value={selected.sort_order}
                onChange={(e) => updateSelected({ sort_order: Number(e.target.value) })}
              />
            </label>
            <label>
              X percent
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={selected.x_pct}
                onChange={(e) => updateSelected({ x_pct: Number(e.target.value) })}
              />
            </label>
            <label>
              Y percent
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={selected.y_pct}
                onChange={(e) => updateSelected({ y_pct: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setSelectedKey(null)}
              className="bg-transparent border border-hairline text-ink px-3 py-1 rounded-md text-sm"
            >
              Done
            </button>
            <button
              type="button"
              onClick={deleteSelected}
              className="bg-transparent border border-danger text-danger px-3 py-1 rounded-md text-sm"
            >
              Delete point
            </button>
          </div>
          <p className="text-xs text-muted mt-2">
            Deleting a point removes it from the draft. If the point appears in historical readings,
            publishing will be rejected — deactivate a point by leaving it present but unused, or
            plan a new template instead.
          </p>
        </section>
      )}

      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={handleSaveDraft} disabled={busy != null}>
          {busy === 'saving' ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="button"
          onClick={handlePublish}
          disabled={busy != null}
          className="bg-ok text-white px-4 rounded-md font-medium min-h-tap"
        >
          {busy === 'publishing' ? 'Publishing…' : `Publish (v${initial.version + 1})`}
        </button>
        {initial.draft_points && (
          <button
            type="button"
            onClick={handleDiscard}
            disabled={busy != null}
            className="bg-transparent border border-hairline text-ink px-4 rounded-md font-medium min-h-tap"
          >
            {busy === 'discarding' ? 'Discarding…' : 'Discard draft'}
          </button>
        )}
      </div>
    </div>
  )
}
