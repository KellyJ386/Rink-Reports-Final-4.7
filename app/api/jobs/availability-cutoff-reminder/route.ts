import { NextResponse } from 'next/server'

import { verifyQstashRequest } from '@/lib/scheduled-jobs/verify-qstash'
import { logger } from '@/lib/observability/logger'

/**
 * Stub until Agent 5 (Scheduling) ships. When Agent 5 lands, its implementation
 * replaces this file's body. The route shape + QStash wiring stays stable.
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

  logger.info('job.availability_cutoff_reminder.stubbed', {
    note: 'Agent 5 ships the implementation',
  })
  return NextResponse.json({ ok: true, stubbed: true })
}
