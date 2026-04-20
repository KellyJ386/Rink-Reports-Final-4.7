import { NextResponse } from 'next/server'

import { publishNotification } from '@/lib/notifications/publish'
import { logScheduledJobRun } from '@/lib/scheduled-jobs/run-logger'
import { verifyQstashRequest } from '@/lib/scheduled-jobs/verify-qstash'
import { createServiceClient } from '@/lib/supabase/service'
import { shiftWeek, currentWeekStart } from '@/lib/scheduling/week'

/**
 * Scheduled daily: nudge staff who haven't submitted availability for upcoming
 * weeks within each facility's cutoff window.
 *
 * Per facility:
 *   1. Read settings.scheduling.availability_cutoff_days (default 14)
 *   2. For each upcoming week within cutoff days, identify active users with
 *      write access to 'scheduling' who have no availability_template rows AND
 *      no availability_overrides for that week.
 *   3. Dedup via NOT EXISTS against notifications where kind =
 *      'availability.cutoff_approaching' and (payload->>'week_start_date') =
 *      W within last 24h.
 *   4. publishNotification fan-out.
 *
 * Wrapped in logScheduledJobRun so /platform-admin/health sees counters.
 */
export async function POST(request: Request) {
  const verified = await verifyQstashRequest(request)
  if (!verified.ok) return new NextResponse(verified.error, { status: 401 })

  const outcome = await logScheduledJobRun('availability-cutoff-reminder', async (ctx) => {
    const svc = createServiceClient()
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    // Pull all non-platform facilities (platform operations facility has no scheduling users)
    const { data: facilities } = await svc
      .from('facilities')
      .select('id, settings, is_platform')
      .eq('is_platform', false)

    let totalNotified = 0
    let totalFailed = 0

    for (const fac of (facilities ?? []) as Array<{
      id: string
      settings: { scheduling?: { availability_cutoff_days?: number } } | null
    }>) {
      const cutoffDays = Math.max(
        1,
        Math.floor(fac.settings?.scheduling?.availability_cutoff_days ?? 14),
      )

      // Upcoming weeks within cutoff
      const weekCount = Math.max(1, Math.ceil(cutoffDays / 7))
      const today = currentWeekStart()
      const weeks: string[] = []
      for (let i = 1; i <= weekCount; i++) weeks.push(shiftWeek(today, i))

      // Staff in facility with any scheduling access (we nudge all active users —
      // template absence is the only signal)
      const { data: facUsers } = await svc
        .from('users')
        .select('id')
        .eq('facility_id', fac.id)
        .eq('active', true)
      const userIds = ((facUsers ?? []) as Array<{ id: string }>).map((u) => u.id)
      if (userIds.length === 0) continue

      // Users with any template row (any day)
      const { data: templatedRows } = await svc
        .from('availability_templates')
        .select('user_id')
        .in('user_id', userIds)
      const templated = new Set(
        ((templatedRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
      )

      for (const week of weeks) {
        // Users with override rows for this week
        const { data: overrideRows } = await svc
          .from('availability_overrides')
          .select('user_id')
          .eq('week_start_date', week)
          .in('user_id', userIds)
        const haveOverride = new Set(
          ((overrideRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
        )

        for (const userId of userIds) {
          // Skip users who have any availability signal for this week
          if (templated.has(userId) || haveOverride.has(userId)) continue

          ctx.bumpProcessed()

          // Dedup
          const { count } = await svc
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('kind', 'availability.cutoff_approaching')
            .eq('payload->>week_start_date', week)
            .gte('created_at', since)
          if ((count ?? 0) > 0) continue

          const r = await publishNotification({
            user_id: userId,
            kind: 'availability.cutoff_approaching',
            payload: {
              week_start_date: week,
              cutoff_days: cutoffDays,
            },
          })
          if (r.ok) {
            totalNotified++
            ctx.bumpSucceeded()
          } else {
            totalFailed++
            ctx.bumpFailed()
          }
        }
      }
    }

    ctx.setMetadata({ facility_count: (facilities ?? []).length })
    return { notified: totalNotified, failed: totalFailed }
  })

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error, run_id: outcome.run_id }, { status: 500 })
  }
  return NextResponse.json({ ok: true, run_id: outcome.run_id, ...outcome.result })
}
