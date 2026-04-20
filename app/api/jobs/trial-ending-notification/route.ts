import { NextResponse } from 'next/server'

import { publishNotification } from '@/lib/notifications/publish'
import { logScheduledJobRun } from '@/lib/scheduled-jobs/run-logger'
import { verifyQstashRequest } from '@/lib/scheduled-jobs/verify-qstash'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Scheduled daily: notify facility admins 7d and 1d before trial_end.
 *
 * Idempotency: we look for an existing notification of kind
 * subscription.trial_ending within the last 24h for each (user) pair.
 */
export async function POST(request: Request) {
  const verified = await verifyQstashRequest(request)
  if (!verified.ok) return new NextResponse(verified.error, { status: 401 })

  const outcome = await logScheduledJobRun('trial-ending-notification', async (ctx) => {
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
        const { data: admins } = await svc
          .from('user_roles')
          .select('user_id, roles!inner(name, facility_id)')
          .eq('roles.facility_id', sub.facility_id)
          .eq('roles.name', 'Admin')

        for (const row of (admins ?? []) as Array<{ user_id: string }>) {
          ctx.bumpProcessed()
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
          if (result.ok) {
            totalNotified++
            ctx.bumpSucceeded()
          } else {
            ctx.bumpFailed()
          }
        }
      }
    }

    return { notified: totalNotified }
  })

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error, run_id: outcome.run_id }, { status: 500 })
  }
  return NextResponse.json({ ok: true, run_id: outcome.run_id, ...outcome.result })
}
