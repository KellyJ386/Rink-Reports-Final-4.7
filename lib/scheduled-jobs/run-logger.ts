import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'
import { logger } from '@/lib/observability/logger'

export type RunLoggerCounters = {
  rows_processed: number
  rows_succeeded: number
  rows_failed: number
}

export type RunLoggerOutcome<T> =
  | { ok: true; run_id: string; result: T; counters: RunLoggerCounters }
  | { ok: false; run_id: string | null; error: string; counters: RunLoggerCounters }

export type HandlerContext = {
  run_id: string
  bumpProcessed: (n?: number) => void
  bumpSucceeded: (n?: number) => void
  bumpFailed: (n?: number) => void
  setMetadata: (m: Record<string, unknown>) => void
}

/**
 * logScheduledJobRun: wraps a job handler in a scheduled_job_runs row lifecycle.
 *
 *   1. INSERT {job_slug, started_at: now()} → run_id
 *   2. await handler(ctx). Handler reports counters via ctx helpers.
 *   3. On success: UPDATE the run row with ended_at, duration_ms, counters,
 *      metadata.
 *   4. On throw: UPDATE with error_if_any and counters — partial progress still
 *      visible in /platform-admin/health.
 *
 * Service-role writes throughout (scheduled_job_runs has no authenticated
 * INSERT/UPDATE policy; service role bypasses RLS).
 *
 * Retrofit pattern for every /api/jobs/* route:
 *
 *   export async function POST(request: Request) {
 *     const verified = await verifyQstashRequest(request)
 *     if (!verified.ok) return new NextResponse(verified.error, { status: 401 })
 *
 *     const outcome = await logScheduledJobRun('job-slug', async (ctx) => {
 *       // ... job body, using ctx.bumpProcessed / bumpSucceeded / bumpFailed
 *       return { foo: 'bar' } // whatever the response body should include
 *     })
 *
 *     if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 500 })
 *     return NextResponse.json({ ok: true, run_id: outcome.run_id, ...outcome.result })
 *   }
 */
export async function logScheduledJobRun<T>(
  jobSlug: string,
  handler: (ctx: HandlerContext) => Promise<T>,
): Promise<RunLoggerOutcome<T>> {
  const svc = createServiceClient()
  const startTs = Date.now()

  const counters: RunLoggerCounters = {
    rows_processed: 0,
    rows_succeeded: 0,
    rows_failed: 0,
  }
  let metadata: Record<string, unknown> = {}

  // 1. Insert start row
  const { data: inserted, error: insertError } = await svc
    .from('scheduled_job_runs')
    .insert({ job_slug: jobSlug })
    .select('id')
    .single()

  if (insertError || !inserted) {
    logger.error('scheduled_job_run.start_insert_failed', {
      job_slug: jobSlug,
      error: insertError?.message,
    })
    return {
      ok: false,
      run_id: null,
      error: insertError?.message ?? 'failed to insert scheduled_job_runs row',
      counters,
    }
  }

  const runId = inserted.id as string

  const ctx: HandlerContext = {
    run_id: runId,
    bumpProcessed: (n = 1) => {
      counters.rows_processed += n
    },
    bumpSucceeded: (n = 1) => {
      counters.rows_succeeded += n
    },
    bumpFailed: (n = 1) => {
      counters.rows_failed += n
    },
    setMetadata: (m) => {
      metadata = { ...metadata, ...m }
    },
  }

  try {
    const result = await handler(ctx)
    const durationMs = Date.now() - startTs

    const { error: updateError } = await svc
      .from('scheduled_job_runs')
      .update({
        ended_at: new Date().toISOString(),
        duration_ms: durationMs,
        rows_processed: counters.rows_processed,
        rows_succeeded: counters.rows_succeeded,
        rows_failed: counters.rows_failed,
        metadata,
      })
      .eq('id', runId)

    if (updateError) {
      logger.warn('scheduled_job_run.end_update_failed', {
        job_slug: jobSlug,
        run_id: runId,
        error: updateError.message,
      })
    }

    logger.info('scheduled_job_run.ok', {
      job_slug: jobSlug,
      run_id: runId,
      duration_ms: durationMs,
      ...counters,
    })

    return { ok: true, run_id: runId, result, counters }
  } catch (err) {
    const durationMs = Date.now() - startTs
    const message = err instanceof Error ? err.message : String(err)

    await svc
      .from('scheduled_job_runs')
      .update({
        ended_at: new Date().toISOString(),
        duration_ms: durationMs,
        rows_processed: counters.rows_processed,
        rows_succeeded: counters.rows_succeeded,
        rows_failed: counters.rows_failed,
        error_if_any: message,
        metadata,
      })
      .eq('id', runId)

    logger.error('scheduled_job_run.failed', {
      job_slug: jobSlug,
      run_id: runId,
      duration_ms: durationMs,
      error: message,
      ...counters,
    })

    return { ok: false, run_id: runId, error: message, counters }
  }
}
