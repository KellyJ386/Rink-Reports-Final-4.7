'use client'

import { submitFormFromClient } from './submit-bridge'
import {
  countActive,
  eligibleForSync,
  markFailed,
  markInFlight,
  markSynced,
  requeueWithBackoff,
} from './queue'

/**
 * Drive the offline-queue sync loop.
 *
 * Call startQueueSync() once at app mount. It:
 *   - runs a sync pass now (if online)
 *   - subscribes to `online` events to retry on reconnect
 *   - sets a lightweight polling interval for backoff-gated retries
 *
 * All queue writes are idempotent (same key → same server row), so overlap is safe.
 */

let started = false
let polling: ReturnType<typeof setInterval> | null = null

export function startQueueSync(): void {
  if (started) return
  started = true

  const run = () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    void syncOnce()
  }

  window.addEventListener('online', run)
  // Backoff-eligibility ticks: every 60s we re-check eligible rows
  polling = setInterval(run, 60_000)
  // First pass
  run()
}

export function stopQueueSync(): void {
  started = false
  if (polling) clearInterval(polling)
  polling = null
}

export async function syncOnce(): Promise<void> {
  const ready = await eligibleForSync()
  for (const row of ready) {
    await markInFlight(row.id)
    const result = await submitFormFromClient({
      moduleSlug: row.module_slug,
      formType: row.form_type,
      values: row.payload,
      idempotencyKey: row.id,
    })
    if (result.ok) {
      await markSynced(row.id)
      continue
    }
    if (result.kind === 'validation') {
      await markFailed(row.id, result.error)
      continue
    }
    // Network / 5xx / unknown — retry with backoff
    await requeueWithBackoff(row.id, result.error)
  }
}

export async function activeCount(): Promise<number> {
  return countActive()
}
