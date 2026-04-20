import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { createOrGetScheduleForWeek } from '@/lib/scheduling/schedule'
import { fetchShiftsWithAssignments } from '@/lib/scheduling/shifts'
import { formatWeekLabel, shiftWeek } from '@/lib/scheduling/week'
import { createClient } from '@/lib/supabase/server'

import { hasSchedulingAdminAccess } from '../../admin-check'
import { WeekBuilderClient } from './builder-client'

export default async function WeekBuilderPage({
  params,
}: {
  params: Promise<{ 'week-start': string }>
}) {
  await requireModuleEnabled('scheduling')
  if (!(await hasSchedulingAdminAccess())) notFound()

  const { 'week-start': weekStart } = await params
  const schedResult = await createOrGetScheduleForWeek(weekStart)
  if (!schedResult.ok) {
    return (
      <main>
        <h1 className="text-xl font-semibold">Unable to load schedule</h1>
        <p className="text-red-700 text-sm mt-2">{schedResult.error}</p>
      </main>
    )
  }
  const schedule = schedResult.schedule

  const supabase = await createClient()
  const [rows, positions, users] = await Promise.all([
    fetchShiftsWithAssignments(schedule.id),
    supabase
      .from('facility_resources')
      .select('id, name, sort_order')
      .eq('resource_type', 'shift_position')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .then((r) => (r.data as Array<{ id: string; name: string; sort_order: number }>) ?? []),
    supabase
      .from('users')
      .select('id, full_name, email')
      .eq('active', true)
      .then((r) => (r.data as Array<{ id: string; full_name: string | null; email: string }>) ?? []),
  ])

  return (
    <main>
      <div className="text-sm">
        <Link href="/modules/scheduling/manage" className="underline">← All schedules</Link>
      </div>

      <div className="hidden lg:block">
        <WeekBuilderClient
          schedule={schedule}
          weekStart={weekStart}
          positions={positions}
          users={users.map((u) => ({ id: u.id, label: u.full_name ?? u.email }))}
          shiftsWithAssignments={rows}
          prevWeek={shiftWeek(weekStart, -1)}
          nextWeek={shiftWeek(weekStart, 1)}
          weekLabel={formatWeekLabel(weekStart)}
        />
      </div>

      <div className="lg:hidden mt-6 border rounded-md p-6 bg-amber-50">
        <h1 className="text-lg font-semibold">Desktop required</h1>
        <p className="text-sm mt-2">
          The manager week builder needs a screen at least 1024px wide. Open this page on
          a laptop or desktop browser.
        </p>
      </div>
    </main>
  )
}
