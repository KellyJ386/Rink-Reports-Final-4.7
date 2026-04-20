import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { fetchSchedulesList } from '@/lib/scheduling/schedule'
import { currentWeekStart, formatWeekLabel, shiftWeek } from '@/lib/scheduling/week'

import { hasSchedulingAdminAccess } from '../admin-check'
import { CreateScheduleButton } from './create-button'

function statusPill(status: 'draft' | 'published' | 'archived') {
  const classes = {
    draft: 'bg-slate-100 text-slate-700 border-slate-300',
    published: 'bg-green-100 text-green-900 border-green-300',
    archived: 'bg-slate-100 text-slate-500 border-slate-300',
  } as const
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded border ${classes[status]}`}>
      {status}
    </span>
  )
}

export default async function ManageSchedulesPage() {
  await requireModuleEnabled('scheduling')
  if (!(await hasSchedulingAdminAccess())) notFound()

  const schedules = await fetchSchedulesList(24)
  const thisWeek = currentWeekStart()
  const nextWeek = shiftWeek(thisWeek, 1)

  return (
    <main>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Manage schedules</h1>
          <p className="text-muted text-sm mt-1">
            Build, assign, publish. Desktop-only; the manager builder shows a notice on mobile.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/modules/scheduling/manage/time-off"
            className="underline text-sm"
          >
            Time-off approvals →
          </Link>
          <Link
            href="/modules/scheduling/manage/swaps"
            className="underline text-sm"
          >
            Swap approvals →
          </Link>
        </div>
      </div>

      <div className="mt-6 flex gap-3 flex-wrap">
        <CreateScheduleButton label={`+ New week (${formatWeekLabel(thisWeek)})`} weekStart={thisWeek} />
        <CreateScheduleButton label={`+ Next week (${formatWeekLabel(nextWeek)})`} weekStart={nextWeek} />
      </div>

      <ul className="mt-6 divide-y border rounded-md max-w-2xl">
        {schedules.length === 0 ? (
          <li className="p-4 text-muted text-sm">No schedules yet.</li>
        ) : (
          schedules.map((s) => (
            <li key={s.id} className="p-3">
              <Link
                href={`/modules/scheduling/manage/${s.week_start_date}`}
                className="flex items-center justify-between no-underline text-inherit"
              >
                <div>
                  <div className="font-medium">Week of {formatWeekLabel(s.week_start_date)}</div>
                  <div className="text-xs text-muted">
                    {s.status === 'published' && s.published_at
                      ? `Published ${new Date(s.published_at).toLocaleString()}`
                      : `Created ${new Date(s.created_at).toLocaleString()}`}
                  </div>
                </div>
                {statusPill(s.status)}
              </Link>
            </li>
          ))
        )}
      </ul>
    </main>
  )
}
