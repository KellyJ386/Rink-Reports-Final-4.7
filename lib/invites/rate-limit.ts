import 'server-only'

/**
 * In-memory token bucket rate limiter.
 *
 * v1 limitations (documented in ONBOARDING.md):
 *   - State lives in the Node.js process. A Vercel cold start resets the bucket.
 *     Attackers that trigger cold starts bypass the limit; practically rare.
 *   - Horizontal scaling (multiple serverless instances) multiplies the limit.
 *     Acceptable for a single-region deploy. Agent 7 swaps to Upstash Ratelimit when
 *     we cross a threshold; the interface here is designed to be drop-in-replaceable.
 *
 * Buckets are keyed by (name, identifier) — e.g. ("accept-invite", ip).
 */

type Bucket = {
  tokens: number
  lastRefill: number
}

type Limit = {
  capacity: number     // max tokens
  refillTokens: number // tokens added per interval
  intervalMs: number   // refill cadence
}

const LIMITS: Record<string, Limit> = {
  'accept-invite': { capacity: 5, refillTokens: 5, intervalMs: 15 * 60 * 1000 },
  'invite-create': { capacity: 20, refillTokens: 20, intervalMs: 60 * 60 * 1000 },
}

const buckets = new Map<string, Bucket>()

function keyOf(name: string, identifier: string) {
  return `${name}::${identifier}`
}

function refill(bucket: Bucket, limit: Limit) {
  const now = Date.now()
  const elapsed = now - bucket.lastRefill
  if (elapsed <= 0) return
  const intervals = Math.floor(elapsed / limit.intervalMs)
  if (intervals > 0) {
    bucket.tokens = Math.min(limit.capacity, bucket.tokens + intervals * limit.refillTokens)
    bucket.lastRefill = now
  }
}

/**
 * Attempt to consume a token. Returns true if allowed, false if rate-limited.
 *
 * @example
 *   if (!consume('accept-invite', clientIp)) {
 *     return new Response('Too many attempts', { status: 429 })
 *   }
 */
export function consume(name: keyof typeof LIMITS | string, identifier: string): boolean {
  const limit = LIMITS[name]
  if (!limit) {
    // Unknown bucket name — fail open, but log so misconfigured callers surface quickly.
    console.warn(`rate-limit: unknown bucket "${name}"; allowing request`)
    return true
  }

  const key = keyOf(name, identifier)
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { tokens: limit.capacity, lastRefill: Date.now() }
    buckets.set(key, bucket)
  }

  refill(bucket, limit)

  if (bucket.tokens <= 0) return false
  bucket.tokens -= 1
  return true
}

/** Test-only: reset every bucket. Not exported in production code paths. */
export function __resetForTests() {
  buckets.clear()
}
