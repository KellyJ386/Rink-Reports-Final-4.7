import { NextResponse } from 'next/server'

import { verifyQstashRequest } from '@/lib/scheduled-jobs/verify-qstash'
import { logger } from '@/lib/observability/logger'

/**
 * Stub until Agent 8 (Communications) ships. The query lives in
 * COMMUNICATIONS.md; when Agent 8 lands, the body inlines it.
 *
 * Idempotency: one ack-reminder per (announcement_id, user_id, day) bucket.
 */
export async function POST(request: Request) {
  const verified = await verifyQstashRequest(request)
  if (!verified.ok) return new NextResponse(verified.error, { status: 401 })

  logger.info('job.ack_reminder.stubbed', { note: 'Agent 8 ships the implementation' })
  return NextResponse.json({ ok: true, stubbed: true })
}
