import 'server-only'

import { RATE_LIMITS, type RateLimitBucket } from './config'

/**
 * In-memory token bucket. Used as the dev + CI fallback when Upstash env vars
 * are absent. In production, `lib/env/require-production-upstash-env.ts` makes
 * the limiter throw at module load, so this code path is unreachable there.
 *
 * State lives in the Node.js process: a cold start resets the bucket and
 * horizontal scaling multiplies the limit. Those are exactly the properties
 * that made the Upstash migration a launch hard-blocker. Production MUST use
 * Upstash; this file exists only so CI + local dev don't need network access.
 */

type BucketState = {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, BucketState>()

function keyOf(name: RateLimitBucket, identifier: string): string {
  return `${name}::${identifier}`
}

function refill(state: BucketState, bucket: (typeof RATE_LIMITS)[RateLimitBucket]): void {
  const now = Date.now()
  const elapsed = now - state.lastRefill
  if (elapsed <= 0) return
  const intervals = Math.floor(elapsed / bucket.windowMs)
  if (intervals > 0) {
    state.tokens = Math.min(
      bucket.requests,
      state.tokens + intervals * bucket.requests,
    )
    state.lastRefill = now
  }
}

/**
 * Attempt to consume a token. Returns true if allowed, false if rate-limited.
 * Synchronous — the Upstash path in `limiter.ts` wraps this in an async
 * signature so callers have one API.
 */
export function consumeInMemory(name: RateLimitBucket, identifier: string): boolean {
  const bucket = RATE_LIMITS[name]
  const key = keyOf(name, identifier)
  let state = buckets.get(key)
  if (!state) {
    state = { tokens: bucket.requests, lastRefill: Date.now() }
    buckets.set(key, state)
  }

  refill(state, bucket)

  if (state.tokens <= 0) return false
  state.tokens -= 1
  return true
}

/** Test-only: reset every bucket so assertions start from a clean slate. */
export function __resetInMemoryBucketsForTests(): void {
  buckets.clear()
}
