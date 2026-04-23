/**
 * Rate limit bucket catalog. Single source of truth consumed by both the
 * Upstash-backed limiter (production) and the in-memory fallback (dev + CI).
 *
 * Adding a bucket:
 *   1. Add an entry here with `requests`, `windowMs`, and `upstashWindow`.
 *   2. The two representations must agree — e.g. `windowMs: 15 * 60 * 1000`
 *      ↔ `upstashWindow: '15 m'`. A mismatch ships as a silently-divergent
 *      limit between dev and prod.
 *   3. Call `consume(bucket, identifier)` from the endpoint. TypeScript's
 *      bucket-name inference keeps typos out.
 */

import type { Duration } from '@upstash/ratelimit'

type Bucket = {
  /** Max requests per window. */
  requests: number
  /** Window size in milliseconds (used by the in-memory fallback). */
  windowMs: number
  /** Window size as a `@upstash/ratelimit` Duration string. */
  upstashWindow: Duration
}

export const RATE_LIMITS = {
  'accept-invite': {
    requests: 5,
    windowMs: 15 * 60 * 1000,
    upstashWindow: '15 m',
  },
  'invite-create': {
    requests: 20,
    windowMs: 60 * 60 * 1000,
    upstashWindow: '1 h',
  },
} as const satisfies Record<string, Bucket>

export type RateLimitBucket = keyof typeof RATE_LIMITS
