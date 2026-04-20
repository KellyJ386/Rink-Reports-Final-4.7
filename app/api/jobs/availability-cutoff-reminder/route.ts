import { NextResponse } from 'next/server'

import { logScheduledJobRun } from '@/lib/scheduled-jobs/run-logger'
import { verifyQstashRequest } from '@/lib/scheduled-jobs/verify-qstash'

/**
 * Stub until Agent 5 (Scheduling) ships. When Agent 5 lands, its implementation
 * replaces the handler body. The route shape + QStash wiring stays stable.
 *
 * Logic when live:
 *   - For each facility, resolve settings.scheduling.availability_cutoff_days
 *   - Find staff who haven't submitted availability for the upcoming cutoff week
 *   - publishNotification({ user_id, kind: 'availability.cutoff_approaching', ... })
 *   - Idempotency: one notification per (user, week_start_date) via notifications
 *     existence check in the last 24h
 */
export async function POST(request: Request) {
  const verified = await verifyQstashRequest(request)
  if (!verified.ok) return new NextResponse(verified.error, { status: 401 })

  const outcome = await logScheduledJobRun('availability-cutoff-reminder', async (ctx) => {
    ctx.setMetadata({ stubbed: true, note: 'Agent 5 ships the implementation' })
    return { stubbed: true }
  })

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error, run_id: outcome.run_id }, { status: 500 })
  }
  return NextResponse.json({ ok: true, run_id: outcome.run_id, ...outcome.result })
}
