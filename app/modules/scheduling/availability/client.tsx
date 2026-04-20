'use client'

import { useEffect, useState, useTransition } from 'react'

import { saveTemplateAction, saveOverridesAction } from '../actions'
import type { AvailabilityTemplateRow } from '@/lib/scheduling/types'
import { DAY_LABELS, formatWeekLabel } from '@/lib/scheduling/week'

type Block = {
  day_of_week: number
  start_time: string
  end_time: string
  status: 'available' | 'unavailable' | 'preferred'
}

function rowsToBlocks(rows: AvailabilityTemplateRow[]): Block[] {
  return rows.map((r) => ({
    day_of_week: r.day_of_week,
    start_time: r.start_time.slice(0, 5),
    end_time: r.end_time.slice(0, 5),
    status: r.status,
  }))
}

function EditableBlocks({
  blocks,
  onChange,
}: {
  blocks: Block[]
  onChange: (b: Block[]) => void
}) {
  const add = () =>
    onChange([
      ...blocks,
      { day_of_week: 0, start_time: '09:00', end_time: '17:00', status: 'available' },
    ])
  const remove = (i: number) => onChange(blocks.filter((_, idx) => idx !== i))
  const patch = (i: number, patch: Partial<Block>) =>
    onChange(blocks.map((b, idx) => (idx === i ? { ...b, ...patch } : b)))

  return (
    <div>
      <ul className="space-y-2">
        {blocks.map((b, i) => (
          <li key={i} className="flex items-center gap-2 border rounded-md p-2">
            <select
              value={b.day_of_week}
              onChange={(e) => patch(i, { day_of_week: parseInt(e.target.value, 10) })}
              className="border rounded px-2 py-1 text-sm"
            >
              {DAY_LABELS.map((label, idx) => (
                <option key={idx} value={idx}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="time"
              value={b.start_time}
              onChange={(e) => patch(i, { start_time: e.target.value })}
              className="border rounded px-2 py-1 text-sm"
            />
            <span>–</span>
            <input
              type="time"
              value={b.end_time}
              onChange={(e) => patch(i, { end_time: e.target.value })}
              className="border rounded px-2 py-1 text-sm"
            />
            <select
              value={b.status}
              onChange={(e) => patch(i, { status: e.target.value as Block['status'] })}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="available">Available</option>
              <option value="preferred">Preferred</option>
              <option value="unavailable">Unavailable</option>
            </select>
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-red-700 underline text-sm ml-auto"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={add}
        className="mt-3 underline text-sm"
      >
        + Add block
      </button>
    </div>
  )
}

export function AvailabilityClient({
  initialTemplate,
  upcomingWeeks,
}: {
  initialTemplate: AvailabilityTemplateRow[]
  upcomingWeeks: string[]
}) {
  const [tab, setTab] = useState<'recurring' | 'override'>('recurring')
  const [template, setTemplate] = useState<Block[]>(rowsToBlocks(initialTemplate))
  const [targetWeek, setTargetWeek] = useState(upcomingWeeks[0] ?? '')
  const [overrideBlocks, setOverrideBlocks] = useState<Block[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    // fetch override rows on week change
    if (!targetWeek) return
    setOverrideBlocks([])
    setStatus(null)
  }, [targetWeek])

  const saveRecurring = () => {
    setStatus(null)
    startTransition(async () => {
      const r = await saveTemplateAction(template)
      setStatus(r.ok ? 'Saved.' : `Error: ${r.error}`)
    })
  }

  const saveOverride = () => {
    setStatus(null)
    startTransition(async () => {
      const r = await saveOverridesAction(targetWeek, overrideBlocks)
      setStatus(r.ok ? 'Saved.' : `Error: ${r.error}`)
    })
  }

  return (
    <div className="mt-6">
      <div className="flex border-b">
        <button
          type="button"
          onClick={() => setTab('recurring')}
          className={`px-4 py-2 text-sm ${tab === 'recurring' ? 'border-b-2 border-accent font-medium' : 'text-muted'}`}
        >
          Recurring template
        </button>
        <button
          type="button"
          onClick={() => setTab('override')}
          className={`px-4 py-2 text-sm ${tab === 'override' ? 'border-b-2 border-accent font-medium' : 'text-muted'}`}
        >
          Week override
        </button>
      </div>

      {tab === 'recurring' ? (
        <div className="mt-4 max-w-2xl">
          <p className="text-sm text-muted mb-3">
            Your default weekly availability. Applies to every future week unless you add a per-week override.
          </p>
          <EditableBlocks blocks={template} onChange={setTemplate} />
          <button
            type="button"
            onClick={saveRecurring}
            disabled={pending}
            className="mt-4 bg-accent text-white px-4 py-2 rounded-md font-medium disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save template'}
          </button>
        </div>
      ) : (
        <div className="mt-4 max-w-2xl">
          <div className="mb-3">
            <label className="block text-sm font-medium">Week</label>
            <select
              value={targetWeek}
              onChange={(e) => setTargetWeek(e.target.value)}
              className="mt-1 border rounded px-3 py-2"
            >
              {upcomingWeeks.map((w) => (
                <option key={w} value={w}>
                  {formatWeekLabel(w)}
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-muted mb-3">
            Add blocks only for the days you want to override. Days you leave alone fall back to your recurring template.
            Days with no block in either place render as &ldquo;no availability submitted.&rdquo;
          </p>
          <EditableBlocks blocks={overrideBlocks} onChange={setOverrideBlocks} />
          <button
            type="button"
            onClick={saveOverride}
            disabled={pending}
            className="mt-4 bg-accent text-white px-4 py-2 rounded-md font-medium disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save override'}
          </button>
        </div>
      )}

      {status ? <p className="mt-3 text-sm">{status}</p> : null}
    </div>
  )
}
