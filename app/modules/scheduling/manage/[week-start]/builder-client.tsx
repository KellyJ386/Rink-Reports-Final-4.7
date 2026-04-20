'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import type { Schedule, Shift } from '@/lib/scheduling/types'
import { DAY_LABELS, daysOfWeek } from '@/lib/scheduling/week'

import {
  addShiftAction,
  assignUserAction,
  copyShiftsAction,
  deleteShiftAction,
  publishScheduleAction,
  reopenScheduleAction,
  archiveScheduleAction,
  unassignUserAction,
} from '../../actions'

type Position = { id: string; name: string; sort_order: number }
type User = { id: string; label: string }
type ShiftRow = { shift: Shift; assignments: Array<{ user_id: string; assigned_at: string }> }

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function isoDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function WeekBuilderClient({
  schedule,
  weekStart,
  positions,
  users,
  shiftsWithAssignments,
  prevWeek,
  nextWeek,
  weekLabel,
}: {
  schedule: Schedule
  weekStart: string
  positions: Position[]
  users: User[]
  shiftsWithAssignments: ShiftRow[]
  prevWeek: string
  nextWeek: string
  weekLabel: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [openShift, setOpenShift] = useState<Shift | null>(null)
  const [newShift, setNewShift] = useState<{
    day: string
    position_id: string
  } | null>(null)
  const [copyChoice, setCopyChoice] = useState<null | {
    mode: 'previous-week' | 'four-weeks-back'
    include_assignments: boolean
  }>(null)
  const [error, setError] = useState<string | null>(null)

  const userLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of users) m.set(u.id, u.label)
    return m
  }, [users])

  const days = useMemo(() => daysOfWeek(weekStart), [weekStart])
  const rowsByPosition = useMemo(() => {
    const m = new Map<string, ShiftRow[]>()
    for (const row of shiftsWithAssignments) {
      const arr = m.get(row.shift.position_resource_id) ?? []
      arr.push(row)
      m.set(row.shift.position_resource_id, arr)
    }
    return m
  }, [shiftsWithAssignments])

  const shiftsForCell = (positionId: string, dayISO: string): ShiftRow[] => {
    return (rowsByPosition.get(positionId) ?? []).filter((r) => isoDay(r.shift.starts_at) === dayISO)
  }

  const publish = () => {
    if (!confirm(`Publish this schedule? Assigned staff will be notified.`)) return
    setError(null)
    startTransition(async () => {
      const r = await publishScheduleAction(schedule.id, weekStart)
      if (r.ok) router.refresh()
      else setError(r.error)
    })
  }

  const reopen = () => {
    if (!confirm('Reopen for edits? The schedule returns to draft status.')) return
    startTransition(async () => {
      const r = await reopenScheduleAction(schedule.id, weekStart)
      if (r.ok) router.refresh()
      else setError(r.error ?? 'Failed.')
    })
  }

  const archive = () => {
    if (!confirm('Archive this schedule?')) return
    startTransition(async () => {
      const r = await archiveScheduleAction(schedule.id, weekStart)
      if (r.ok) router.push('/modules/scheduling/manage')
      else setError(r.error ?? 'Failed.')
    })
  }

  const doCopy = async (force: boolean) => {
    if (!copyChoice) return
    startTransition(async () => {
      const r = await copyShiftsAction(
        schedule.id,
        weekStart,
        copyChoice.mode,
        copyChoice.include_assignments,
        force,
      )
      if (r.ok) {
        setCopyChoice(null)
        router.refresh()
      } else if (r.error === 'target_has_shifts') {
        if (confirm('This week already has shifts. Replace them?')) {
          void doCopy(true)
        }
      } else {
        setError(r.error ?? 'Copy failed.')
      }
    })
  }

  const addShiftSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!newShift) return
    const fd = new FormData(e.currentTarget)
    const startTime = String(fd.get('start_time'))
    const endTime = String(fd.get('end_time'))
    const notes = String(fd.get('notes') ?? '')
    const required = parseInt(String(fd.get('required_headcount') ?? '1'), 10) || 1
    const startsAt = new Date(`${newShift.day}T${startTime}:00`).toISOString()
    const endsAt = new Date(`${newShift.day}T${endTime}:00`).toISOString()
    startTransition(async () => {
      const r = await addShiftAction(schedule.id, weekStart, {
        position_resource_id: newShift.position_id,
        starts_at: startsAt,
        ends_at: endsAt,
        notes: notes || undefined,
        required_headcount: required,
      })
      if (r.ok) {
        setNewShift(null)
        router.refresh()
      } else {
        setError(r.error)
      }
    })
  }

  const assign = (shiftId: string, userId: string) => {
    startTransition(async () => {
      const r = await assignUserAction(schedule.id, weekStart, shiftId, userId)
      if (r.ok) {
        router.refresh()
      } else if ((r as { code?: string }).code === 'overlap') {
        alert(
          'This staff member is already on an overlapping shift within the same week (±24h). Choose someone else or adjust the conflicting shift.',
        )
      } else {
        alert((r as { error: string }).error)
      }
    })
  }

  const unassign = (shiftId: string, userId: string) => {
    startTransition(async () => {
      const r = await unassignUserAction(schedule.id, weekStart, shiftId, userId)
      if (r.ok) router.refresh()
      else alert(r.error)
    })
  }

  const deleteIt = (shiftId: string) => {
    if (!confirm('Delete this shift?')) return
    startTransition(async () => {
      const r = await deleteShiftAction(schedule.id, weekStart, shiftId)
      if (r.ok) {
        setOpenShift(null)
        router.refresh()
      } else {
        alert(r.error)
      }
    })
  }

  return (
    <div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Week of {weekLabel}</h1>
        <span
          className={`inline-block text-xs px-2 py-0.5 rounded border ${
            schedule.status === 'published'
              ? 'bg-green-100 text-green-900 border-green-300'
              : schedule.status === 'archived'
                ? 'bg-slate-100 text-slate-500 border-slate-300'
                : 'bg-slate-100 text-slate-700 border-slate-300'
          }`}
        >
          {schedule.status}
        </span>
        <Link href={`/modules/scheduling/manage/${prevWeek}`} className="underline text-sm">← Prev</Link>
        <Link href={`/modules/scheduling/manage/${nextWeek}`} className="underline text-sm">Next →</Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => setCopyChoice({ mode: 'previous-week', include_assignments: false })}
            className="underline"
          >
            Copy previous week
          </button>
          <span className="text-muted">|</span>
          <button
            type="button"
            onClick={() => setCopyChoice({ mode: 'four-weeks-back', include_assignments: false })}
            className="underline"
          >
            Copy 4 weeks back
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {schedule.status === 'draft' ? (
            <button
              type="button"
              onClick={publish}
              disabled={pending}
              className="bg-accent text-white px-4 py-2 rounded-md font-medium disabled:opacity-50"
            >
              {pending ? '…' : 'Publish'}
            </button>
          ) : null}
          {schedule.status === 'published' ? (
            <button type="button" onClick={reopen} disabled={pending} className="underline text-sm">
              Reopen for edits
            </button>
          ) : null}
          {schedule.status !== 'archived' ? (
            <button type="button" onClick={archive} disabled={pending} className="underline text-sm text-red-700">
              Archive
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="mt-3 text-red-700 text-sm">{error}</p> : null}

      {copyChoice ? (
        <div className="mt-4 border rounded-md p-4 max-w-xl">
          <p className="text-sm">
            {copyChoice.mode === 'previous-week'
              ? 'Copy shifts from the previous week.'
              : 'Copy shifts from exactly 28 days prior (4 Sundays back).'}
          </p>
          <label className="flex items-center gap-2 mt-2 text-sm">
            <input
              type="checkbox"
              checked={copyChoice.include_assignments}
              onChange={(e) =>
                setCopyChoice({ ...copyChoice, include_assignments: e.target.checked })
              }
            />
            Include assignments
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => doCopy(false)}
              disabled={pending}
              className="bg-accent text-white px-4 py-1.5 rounded-md text-sm font-medium disabled:opacity-50"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setCopyChoice(null)}
              className="underline text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="border bg-slate-50 text-left px-3 py-2">Position</th>
              {days.map((d, i) => (
                <th key={d} className="border bg-slate-50 text-left px-3 py-2">
                  {DAY_LABELS[i]}{' '}
                  <span className="text-muted text-xs">
                    {new Date(d).getDate()}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 ? (
              <tr>
                <td colSpan={8} className="border p-4 text-muted">
                  No shift positions configured. Ask your admin to add them under{' '}
                  <Link href="/admin/resources" className="underline">/admin/resources</Link>.
                </td>
              </tr>
            ) : (
              positions.map((p) => (
                <tr key={p.id}>
                  <td className="border px-3 py-2 align-top font-medium">{p.name}</td>
                  {days.map((d) => (
                    <td key={d} className="border px-2 py-2 align-top min-w-[120px]">
                      {shiftsForCell(p.id, d).map((row) => (
                        <button
                          key={row.shift.id}
                          type="button"
                          onClick={() => setOpenShift(row.shift)}
                          className="block w-full text-left bg-sky-50 border border-sky-200 rounded px-2 py-1 mb-1 hover:bg-sky-100"
                        >
                          <div className="font-medium">
                            {fmtTime(row.shift.starts_at)}–{fmtTime(row.shift.ends_at)}
                          </div>
                          <div className="text-xs text-muted">
                            {row.assignments.length}/{row.shift.required_headcount} assigned
                          </div>
                        </button>
                      ))}
                      {schedule.status !== 'archived' ? (
                        <button
                          type="button"
                          onClick={() => setNewShift({ day: d, position_id: p.id })}
                          className="text-xs underline text-muted"
                        >
                          + add
                        </button>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {newShift ? (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <form
            onSubmit={addShiftSubmit}
            className="bg-white rounded-md p-4 max-w-md w-full shadow-lg space-y-3"
          >
            <h2 className="font-semibold">Add shift — {new Date(newShift.day).toDateString()}</h2>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                Start
                <input name="start_time" type="time" defaultValue="09:00" required className="mt-1 w-full border rounded px-2 py-1" />
              </label>
              <label className="text-sm">
                End
                <input name="end_time" type="time" defaultValue="17:00" required className="mt-1 w-full border rounded px-2 py-1" />
              </label>
            </div>
            <label className="block text-sm">
              Required headcount
              <input name="required_headcount" type="number" defaultValue={1} min={1} className="mt-1 w-full border rounded px-2 py-1" />
            </label>
            <label className="block text-sm">
              Notes
              <textarea name="notes" rows={2} className="mt-1 w-full border rounded px-2 py-1" />
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setNewShift(null)} className="underline text-sm">
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="bg-accent text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
              >
                {pending ? 'Saving…' : 'Add'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {openShift ? (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-md p-4 max-w-md w-full shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">
                {fmtTime(openShift.starts_at)}–{fmtTime(openShift.ends_at)}
              </h2>
              <button type="button" onClick={() => setOpenShift(null)} className="text-sm underline">
                Close
              </button>
            </div>
            {openShift.notes ? <p className="text-sm text-muted">{openShift.notes}</p> : null}
            <div>
              <h3 className="text-sm font-medium mb-1">Assigned</h3>
              {(shiftsWithAssignments.find((r) => r.shift.id === openShift.id)?.assignments ?? []).length === 0 ? (
                <p className="text-sm text-muted">No one assigned yet.</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {(shiftsWithAssignments.find((r) => r.shift.id === openShift.id)?.assignments ?? []).map((a) => (
                    <li key={a.user_id} className="flex items-center justify-between">
                      <span>{userLabel.get(a.user_id) ?? a.user_id.slice(0, 8)}</span>
                      <button
                        type="button"
                        onClick={() => unassign(openShift.id, a.user_id)}
                        className="text-xs underline text-red-700"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium mb-1">Assign a user</h3>
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    assign(openShift.id, e.target.value)
                    e.target.value = ''
                  }
                }}
                className="w-full border rounded px-2 py-1 text-sm"
                defaultValue=""
              >
                <option value="">Pick a user…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="pt-3 border-t flex justify-end">
              <button
                type="button"
                onClick={() => deleteIt(openShift.id)}
                disabled={pending}
                className="text-sm underline text-red-700"
              >
                Delete shift
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
