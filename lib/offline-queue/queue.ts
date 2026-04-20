'use client'

import { getDb, type QueuedSubmission } from './db'

/**
 * Client-side queue operations. All Dexie I/O lives here.
 */

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `k_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

export type EnqueueInput = {
  module_slug: string
  form_type: string | null
  payload: Record<string, unknown>
  /** If the caller already has an idempotency key (e.g. from a prior attempt),
   *  reuse it. Otherwise a new uuid is generated. */
  idempotency_key?: string
}

export async function enqueueSubmission(input: EnqueueInput): Promise<QueuedSubmission> {
  const db = getDb()
  const row: QueuedSubmission = {
    id: input.idempotency_key ?? newId(),
    module_slug: input.module_slug,
    form_type: input.form_type,
    payload: input.payload,
    created_at: new Date().toISOString(),
    attempts: 0,
    status: 'queued',
  }
  await db.queued_submissions.put(row)
  return row
}

export async function listQueue(): Promise<QueuedSubmission[]> {
  const db = getDb()
  return db.queued_submissions.orderBy('created_at').toArray()
}

export async function countActive(): Promise<number> {
  const db = getDb()
  return db.queued_submissions
    .where('status')
    .anyOf('queued', 'in_flight')
    .count()
}

export async function markInFlight(id: string): Promise<void> {
  const db = getDb()
  await db.queued_submissions.update(id, { status: 'in_flight' })
}

export async function markSynced(id: string): Promise<void> {
  const db = getDb()
  await db.queued_submissions.update(id, { status: 'synced', last_error: undefined })
}

export async function markFailed(id: string, error: string): Promise<void> {
  const db = getDb()
  await db.queued_submissions.update(id, { status: 'failed', last_error: error })
}

export async function requeueWithBackoff(
  id: string,
  error: string,
): Promise<void> {
  const db = getDb()
  const row = await db.queued_submissions.get(id)
  if (!row) return
  const nextAttempts = row.attempts + 1
  // Mark queued again; sync loop uses attempts + created_at to decide backoff.
  await db.queued_submissions.update(id, {
    status: 'queued',
    attempts: nextAttempts,
    last_error: error,
  })
}

export async function discardQueued(id: string): Promise<void> {
  const db = getDb()
  await db.queued_submissions.delete(id)
}

/**
 * Exponential backoff schedule. attempts → delay-ms. Capped at 12 hours.
 * 1m, 5m, 15m, 1h, 4h, 12h, 12h, ...
 */
const BACKOFF_SCHEDULE_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  4 * 60 * 60_000,
  12 * 60 * 60_000,
]

const MAX_AGE_MS = 24 * 60 * 60_000 // after 24h of failures, move to 'failed'

/**
 * Returns the queued rows that are eligible for a sync attempt right now.
 */
export async function eligibleForSync(): Promise<QueuedSubmission[]> {
  const db = getDb()
  const now = Date.now()
  const candidates = await db.queued_submissions.where('status').equals('queued').toArray()
  const ready: QueuedSubmission[] = []

  for (const row of candidates) {
    const createdMs = new Date(row.created_at).getTime()
    if (row.attempts === 0) {
      ready.push(row)
      continue
    }
    if (now - createdMs > MAX_AGE_MS) {
      await markFailed(row.id, row.last_error ?? 'Retry budget exhausted (24h)')
      continue
    }
    const stepIdx = Math.min(row.attempts - 1, BACKOFF_SCHEDULE_MS.length - 1)
    const delay = BACKOFF_SCHEDULE_MS[stepIdx]!
    // Eligibility: last attempt was at least `delay` ago. We approximate the
    // last-attempt timestamp by adding cumulative backoff to created_at.
    const cumulative = BACKOFF_SCHEDULE_MS.slice(0, row.attempts).reduce((a, b) => a + b, 0)
    if (now - createdMs >= cumulative - delay) ready.push(row)
  }

  return ready.sort((a, b) => a.created_at.localeCompare(b.created_at))
}
