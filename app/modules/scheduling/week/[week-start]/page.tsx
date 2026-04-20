import Link from 'next/link'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { fetchMyShiftsForWeek } from '@/lib/scheduling/schedule'
import { formatWeekLabel, shiftWeek } from '@/lib/scheduling/week'

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export default async function WeekViewPage({
  params,
}: {
  params: Promise<{ 'week-start': string }>
}) {
  await requireModuleEnabled('scheduling')
  const { 'week-start': weekStart } = await params
  const assignments = await fetchMyShiftsForWeek(weekStart)

  return (
    <main>
      <div className="text-sm">
        <Link href="/modules/scheduling" className="underline">← My schedule</Link>
      </div>
      <h1 className="text-xl font-semibold mt-2">Week of {formatWeekLabel(weekStart)}</h1>

      <div className="mt-2 flex gap-3 text-sm">
        <Link href={`/modules/scheduling/week/${shiftWeek(weekStart, -1)}`} className="underline">
          ← Previous
        </Link>
        <Link href={`/modules/scheduling/week/${shiftWeek(weekStart, 1)}`} className="underline">
          Next →
        </Link>
      </div>

      <section className="mt-6">
        {assignments.length === 0 ? (
          <p className="text-muted">No shifts for this week.</p>
        ) : (
          <ul className="space-y-2">
            {assignments.map((a) => (
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
    </main>
  )
}
