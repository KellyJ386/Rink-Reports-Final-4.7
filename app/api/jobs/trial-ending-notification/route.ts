import { NextResponse } from 'next/server'

import { publishNotification } from '@/lib/notifications/publish'
import { verifyQstashRequest } from '@/lib/scheduled-jobs/verify-qstash'
import { createServiceClient } from '@/lib/supabase/service'
import { logger } from '@/lib/observability/logger'

/**
 * Scheduled daily: notify facility admins 7d and 1d before trial_end.
 *
 * Idempotency: we look for an existing notification of kind
 * subscription.trial_ending with payload.days_remaining == N sent within the
 * last 24h for each (user, facility) pair. Skip if present.
 */
export async function POST(request: Request) {
  const verified = await verifyQstashRequest(request)
  if (!verified.ok) return new NextResponse(verified.error, { status: 401 })

  const svc = createServiceClient()
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000

  const targets: Array<{ days: number; min: number; max: number }> = [
    { days: 7, min: now + 6.5 * dayMs, max: now + 7.5 * dayMs },
    { days: 1, min: now + 0.5 * dayMs, max: now + 1.5 * dayMs },
  ]

  let totalNotified = 0

  for (const t of targets) {
    const { data: subs } = await svc
      .from('facility_subscriptions')
      .select('facility_id, trial_end')
      .eq('status', 'trialing')
      .gte('trial_end', new Date(t.min).toISOString())
      .lte('trial_end', new Date(t.max).toISOString())

    for (const sub of (subs ?? []) as Array<{ facility_id: string; trial_end: string | null }>) {
      // Find admins
      const { data: admins } = await svc
        .from('user_roles')
        .select('user_id, roles!inner(name, facility_id)')
        .eq('roles.facility_id', sub.facility_id)
        .eq('roles.name', 'Admin')

      for (const row of (admins ?? []) as Array<{ user_id: string }>) {
        // Dedup: any trial_ending notification in the last 24h for this user
        const since = new Date(now - dayMs).toISOString()
        const { count } = await svc
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', row.user_id)
          .eq('kind', 'subscription.trial_ending')
          .gte('created_at', since)

        if ((count ?? 0) > 0) continue

        const result = await publishNotification({
          user_id: row.user_id,
          kind: 'subscription.trial_ending',
          payload: { days_remaining: t.days, trial_end: sub.trial_end },
        })
        if (result.ok) totalNotified++
      }
    }
  }

  logger.info('job.trial_ending_notification.ok', { notified: totalNotified })
  return NextResponse.json({ ok: true, notified: totalNotified })
}
