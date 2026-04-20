import Link from 'next/link'

import { requireModuleEnabled } from '@/lib/modules/require-enabled'
import { fetchMyTemplate } from '@/lib/scheduling/availability'
import { loadSchedulingSettings } from '@/lib/scheduling/settings'
import { currentWeekStart, shiftWeek } from '@/lib/scheduling/week'

import { AvailabilityClient } from './client'

export default async function AvailabilityPage() {
  await requireModuleEnabled('scheduling')

  const settings = await loadSchedulingSettings()
  const templateRows = await fetchMyTemplate()

  // Build the list of "upcoming weeks within cutoff" for the overrides tab
  const today = currentWeekStart()
  const weeks: string[] = []
  const weekCount = Math.max(2, Math.ceil(settings.availability_cutoff_days / 7))
  for (let i = 0; i < weekCount; i++) {
    weeks.push(shiftWeek(today, i))
  }

  return (
    <main>
      <div className="text-sm">
        <Link href="/modules/scheduling" className="underline">← My schedule</Link>
      </div>
      <h1 className="text-xl font-semibold mt-2">My availability</h1>
      <p className="text-muted text-sm mt-1">
        Recurring template is your default availability. Per-week overrides apply on top —
        days without an override fall back to the template.
      </p>

      <AvailabilityClient
        initialTemplate={templateRows}
        upcomingWeeks={weeks}
      />
    </main>
  )
}
