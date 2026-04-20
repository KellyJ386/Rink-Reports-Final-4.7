import { NextResponse } from 'next/server'

import { publishNotification } from '@/lib/notifications/publish'
import { logScheduledJobRun } from '@/lib/scheduled-jobs/run-logger'
import { verifyQstashRequest } from '@/lib/scheduled-jobs/verify-qstash'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Scheduled daily: nudge users who haven't acknowledged announcements with
 * requires_acknowledgment = true.
 *
 * Window: 24h after posted_at, non-archived, non-expired, unacked by the user.
 *
 * Idempotency: at most one ack_reminder notification per (user, announcement_id)
 * per 24h, enforced by a NOT EXISTS subquery against notifications. The partial
 * index notifications_ack_reminder_announcement_idx keeps the lookup fast at
 * volume.
 *
 * Safety rails:
 *   - LIMIT 1000 per run (if the backlog exceeds that, next invocation picks up
 *     the rest — keeps a single run bounded).
 *   - ORDER BY posted_at ASC (oldest reminders first).
 *
 * Establishes the scheduled-job observability pattern: every run inserts a
 * scheduled_job_runs row with counters + duration + error_if_any. See
 * lib/scheduled-jobs/run-logger.ts.
 */
export async function POST(request: Request) {
  const verified = await verifyQstashRequest(request)
  if (!verified.ok) return new NextResponse(verified.error, { status: 401 })

  const outcome = await logScheduledJobRun('ack-reminder', async (ctx) => {
    const svc = createServiceClient()
    const now = new Date()
    const dayMs = 24 * 60 * 60 * 1000
    const windowStart = new Date(now.getTime() - 30 * dayMs).toISOString() // look back 30d max
    const ackOverdueCutoff = new Date(now.getTime() - dayMs).toISOString() // 24h past posted

    // Raw SQL: the NOT EXISTS dedup is clearer as a single query than a JS loop
    // over every candidate pair. Uses the expression index on
    // notifications_ack_reminder_announcement_idx for constant-time subquery.
    const { data: candidates, error } = await svc.rpc('ack_reminder_candidates', {
      p_window_start: windowStart,
      p_overdue_cutoff: ackOverdueCutoff,
      p_limit: 1000,
    })

    if (error) {
      // Fallback path if the RPC isn't deployed — query the tables directly.
      // Slower but still correct; used only during the first deploy window.
      return await reminderCandidatesFallback(ctx, svc, windowStart, ackOverdueCutoff)
    }

    const rows = (candidates ?? []) as Array<{
      user_id: string
      announcement_id: string
      title: string
      priority: string
      posted_at: string
    }>

    ctx.setMetadata({ candidate_count: rows.length })

    let notified = 0
    let failed = 0

    for (const row of rows) {
      ctx.bumpProcessed()
      const result = await publishNotification({
        user_id: row.user_id,
        kind: 'announcement.ack_reminder',
        payload: {
          announcement_id: row.announcement_id,
          title: row.title,
          priority: row.priority,
          posted_at: row.posted_at,
        },
      })
      if (result.ok) {
        notified++
        ctx.bumpSucceeded()
      } else {
        failed++
        ctx.bumpFailed()
      }
    }

    return { notified, failed, candidates: rows.length }
  })

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error, run_id: outcome.run_id }, { status: 500 })
  }
  return NextResponse.json({ ok: true, run_id: outcome.run_id, ...outcome.result })
}

/**
 * Fallback path — queries announcements + announcement_reads + notifications
 * directly. Used if the ack_reminder_candidates RPC isn't deployed yet.
 */
async function reminderCandidatesFallback(
  ctx: {
    bumpProcessed: (n?: number) => void
    bumpSucceeded: (n?: number) => void
    bumpFailed: (n?: number) => void
    setMetadata: (m: Record<string, unknown>) => void
  },
  svc: ReturnType<typeof createServiceClient>,
  _windowStart: string,
  ackOverdueCutoff: string,
) {
  const { data: reads } = await svc
    .from('announcement_reads')
    .select(
      'user_id, announcement_id, read_at, announcements!inner(id, title, priority, posted_at, expires_at, is_archived, requires_acknowledgment)',
    )
    .is('acknowledged_at', null)
    .eq('announcements.requires_acknowledgment', true)
    .eq('announcements.is_archived', false)
    .lt('announcements.posted_at', ackOverdueCutoff)
    .order('read_at', { ascending: true })
    .limit(1000)

  const candidates: Array<{
    user_id: string
    announcement_id: string
    title: string
    priority: string
    posted_at: string
  }> = []

  for (const r of (reads ?? []) as Array<{
    user_id: string
    announcement_id: string
    announcements: {
      title: string
      priority: string
      posted_at: string
      expires_at: string | null
    } | Array<{ title: string; priority: string; posted_at: string; expires_at: string | null }>
  }>) {
    const a = Array.isArray(r.announcements) ? r.announcements[0] : r.announcements
    if (!a) continue
    if (a.expires_at && new Date(a.expires_at).getTime() <= Date.now()) continue

    // Dedup: any ack_reminder for this (user, announcement) in the last 24h?
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count } = await svc
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', r.user_id)
      .eq('kind', 'announcement.ack_reminder')
      .gte('created_at', since)

    if ((count ?? 0) > 0) continue

    candidates.push({
      user_id: r.user_id,
      announcement_id: r.announcement_id,
      title: a.title,
      priority: a.priority,
      posted_at: a.posted_at,
    })
  }

  ctx.setMetadata({ candidate_count: candidates.length, fallback: true })

  let notified = 0
  let failed = 0
  for (const c of candidates) {
    ctx.bumpProcessed()
    const result = await publishNotification({
      user_id: c.user_id,
      kind: 'announcement.ack_reminder',
      payload: {
        announcement_id: c.announcement_id,
        title: c.title,
        priority: c.priority,
        posted_at: c.posted_at,
      },
    })
    if (result.ok) {
      notified++
      ctx.bumpSucceeded()
    } else {
      failed++
      ctx.bumpFailed()
    }
  }

  return { notified, failed, candidates: candidates.length }
}
