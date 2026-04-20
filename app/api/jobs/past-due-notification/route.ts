import { NextResponse } from 'next/server'

import { publishNotification } from '@/lib/notifications/publish'
import { verifyQstashRequest } from '@/lib/scheduled-jobs/verify-qstash'
import { createServiceClient } from '@/lib/supabase/service'
import { logger } from '@/lib/observability/logger'

/**
 * Scheduled daily: escalating past-due reminders at days 1, 3, 7 after
 * current_period_end. Per-facility per-day dedup via notifications lookup.
 */
export async function POST(request: Request) {
  const verified = await verifyQstashRequest(request)
  if (!verified.ok) return new NextResponse(verified.error, { status: 401 })

  const svc = createServiceClient()
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000

  // Days-since-current_period_end buckets we alert on
  const schedule: Array<{ day: number; min: number; max: number }> = [
    { day: 1, min: now - 1.5 * dayMs, max: now - 0.5 * dayMs },
    { day: 3, min: now - 3.5 * dayMs, max: now - 2.5 * dayMs },
    { day: 7, min: now - 7.5 * dayMs, max: now - 6.5 * dayMs },
  ]

  let totalNotified = 0

  for (const entry of schedule) {
    const { data: subs } = await svc
      .from('facility_subscriptions')
      .select('facility_id, current_period_end')
      .eq('status', 'past_due')
      .gte('current_period_end', new Date(entry.min).toISOString())
      .lte('current_period_end', new Date(entry.max).toISOString())

    for (const sub of (subs ?? []) as Array<{ facility_id: string; current_period_end: string | null }>) {
      const { data: admins } = await svc
        .from('user_roles')
        .select('user_id, roles!inner(name, facility_id)')
        .eq('roles.facility_id', sub.facility_id)
        .eq('roles.name', 'Admin')

      for (const row of (admins ?? []) as Array<{ user_id: string }>) {
        const since = new Date(now - dayMs).toISOString()
        const { count } = await svc
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', row.user_id)
          .eq('kind', 'subscription.past_due')
          .gte('created_at', since)

        if ((count ?? 0) > 0) continue

        const result = await publishNotification({
          user_id: row.user_id,
          kind: 'subscription.past_due',
          payload: { day: entry.day, current_period_end: sub.current_period_end },
        })
        if (result.ok) totalNotified++
      }
    }
  }

  logger.info('job.past_due_notification.ok', { notified: totalNotified })
  return NextResponse.json({ ok: true, notified: totalNotified })
}
