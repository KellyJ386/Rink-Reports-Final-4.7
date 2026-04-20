'use client'

import Dexie, { type EntityTable } from 'dexie'

/**
 * Dexie schema for the offline submission queue.
 *
 * One IndexedDB DB per-browser (not per-facility; users typically belong to one
 * facility anyway, and the idempotency_key on the server already scopes writes).
 */

export type QueuedSubmissionStatus = 'queued' | 'in_flight' | 'synced' | 'failed'

export type QueuedSubmission = {
  /** Client-generated uuid. IS the server-side idempotency_key. Primary key. */
  id: string
  module_slug: string
  form_type: string | null
  /** Payload passed to submitForm (values only; engine derives the rest). */
  payload: Record<string, unknown>
  created_at: string // ISO
  attempts: number
  last_error?: string
  status: QueuedSubmissionStatus
}

class RinkReportsDB extends Dexie {
  queued_submissions!: EntityTable<QueuedSubmission, 'id'>

  constructor() {
    super('rinkreports')
    this.version(1).stores({
      // Indexes: `status` for queue scans; `created_at` for FIFO order.
      queued_submissions: 'id, status, created_at',
    })
  }
}

let db: RinkReportsDB | null = null

export function getDb(): RinkReportsDB {
  if (!db) db = new RinkReportsDB()
  return db
}
