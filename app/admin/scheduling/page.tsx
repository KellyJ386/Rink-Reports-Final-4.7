import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'
import { getAllSettings } from '@/lib/facility/settings'

import { SchedulingSettingsClient } from './client'

export default async function AdminSchedulingPage() {
  const settings = await getAllSettings()

  const supabase = await createClient()
  const [
    { count: scheduleCount },
    { count: publishedCount },
    { count: positionCount },
  ] = await Promise.all([
    supabase.from('schedules').select('*', { count: 'exact', head: true }),
    supabase
      .from('schedules')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'published'),
    supabase
      .from('facility_resources')
      .select('*', { count: 'exact', head: true })
      .eq('resource_type', 'shift_position')
      .eq('is_active', true),
  ])

  return (
    <main>
      <h1 className="text-xl font-semibold">Scheduling</h1>
      <p className="text-muted text-sm mt-1">
        Configure module-wide scheduling behavior. The builder and approval queues live under{' '}
        <Link href="/modules/scheduling/manage" className="underline">
          /modules/scheduling/manage
        </Link>
        .
      </p>

      <section className="mt-6 grid grid-cols-3 gap-3 max-w-2xl">
        <div className="border border-hairline rounded-md p-3">
          <div className="text-xs uppercase tracking-wide text-muted">Schedules</div>
          <div className="text-2xl font-semibold">{scheduleCount ?? 0}</div>
        </div>
        <div className="border border-hairline rounded-md p-3">
          <div className="text-xs uppercase tracking-wide text-muted">Published</div>
          <div className="text-2xl font-semibold">{publishedCount ?? 0}</div>
        </div>
        <div className="border border-hairline rounded-md p-3">
          <div className="text-xs uppercase tracking-wide text-muted">Shift positions</div>
          <div className="text-2xl font-semibold">{positionCount ?? 0}</div>
        </div>
      </section>

      {positionCount === 0 ? (
        <p className="mt-4 text-amber-700 text-sm max-w-2xl">
          No shift positions configured. Managers cannot build schedules until you add positions
          under{' '}
          <Link href="/admin/resources" className="underline">
            /admin/resources
          </Link>{' '}
          (resource type <code>shift_position</code>).
        </p>
      ) : null}

      <SchedulingSettingsClient
        initialCutoffDays={Number(settings['scheduling.availability_cutoff_days'] ?? 14)}
        initialSwapApprovalMode={
          settings['scheduling.swap_approval_mode'] === 'free' ? 'free' : 'manager_approval'
        }
      />

      <section className="mt-10 max-w-2xl">
        <h2 className="font-medium">Week start</h2>
        <p className="text-muted text-sm mt-1">
          Fixed to <strong>Sunday</strong> in v1. Enforced by CHECK constraints on all
          week-keyed tables. See{' '}
          <Link href="https://github.com/KellyJ386/Rink-Reports-Final-4.7/blob/main/SCHEDULING.md" className="underline">
            SCHEDULING.md
          </Link>{' '}
          for the full rationale.
        </p>
      </section>

      <section className="mt-10 max-w-2xl">
        <h2 className="font-medium">Bulk copy</h2>
        <p className="text-muted text-sm mt-1">
          Two options on the week builder: <em>Copy previous week</em> (7 days back) and{' '}
          <em>Copy 4 weeks back</em> (exactly 28 days back). Both can optionally carry over
          assignments — the overlap-block trigger silently skips any individual carry-over that
          would collide.
        </p>
      </section>
    </main>
  )
}
