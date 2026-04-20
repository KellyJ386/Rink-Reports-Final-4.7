import Link from 'next/link'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { fetchMyShiftsForWeek } from '@/lib/scheduling/schedule'
import { currentWeekStart, formatWeekLabel, shiftWeek } from '@/lib/scheduling/week'

import { hasSchedulingAdminAccess } from './admin-check'

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export default async function SchedulingHomePage() {
  await requireModuleEnabled('scheduling')
  const week = currentWeekStart()
  const nextWeek = shiftWeek(week, 1)
  const [thisWeek, next, isManager] = await Promise.all([
    fetchMyShiftsForWeek(week),
    fetchMyShiftsForWeek(nextWeek),
    hasSchedulingAdminAccess(),
  ])

  return (
    <main>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">My schedule</h1>
        {isManager ? (
          <Link
            href="/modules/scheduling/manage"
            className="underline text-sm"
          >
            Manage schedules →
          </Link>
        ) : null}
      </div>
      <p className="text-muted text-sm mt-1">
        Week of {formatWeekLabel(week)}
      </p>

      <nav className="mt-4 flex gap-4 text-sm">
        <Link href="/modules/scheduling/availability" className="underline">
          Availability
        </Link>
        <Link href="/modules/scheduling/time-off" className="underline">
          Time off
        </Link>
        <Link href="/modules/scheduling/swaps" className="underline">
          Swaps
        </Link>
      </nav>

      <section className="mt-6">
        <h2 className="font-medium">This week</h2>
        {thisWeek.length === 0 ? (
          <p className="text-muted text-sm mt-2">No shifts assigned.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {thisWeek.map((a) => (
              <li key={a.id} className="border rounded-md p-3">
                <div className="text-xs text-muted">{fmtDay(a.shift.starts_at)}</div>
                <div className="font-medium">{a.shift.position?.name ?? 'Position'}</div>
                <div className="text-sm">
                  {fmtTime(a.shift.starts_at)} – {fmtTime(a.shift.ends_at)}
                </div>
                {a.shift.notes ? (
                  <div className="text-xs text-muted mt-1">{a.shift.notes}</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="font-medium">Next week</h2>
        {next.length === 0 ? (
          <p className="text-muted text-sm mt-2">Not yet published.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {next.map((a) => (
              <li key={a.id} className="border rounded-md p-3">
                <div className="text-xs text-muted">{fmtDay(a.shift.starts_at)}</div>
                <div className="font-medium">{a.shift.position?.name ?? 'Position'}</div>
                <div className="text-sm">
                  {fmtTime(a.shift.starts_at)} – {fmtTime(a.shift.ends_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
