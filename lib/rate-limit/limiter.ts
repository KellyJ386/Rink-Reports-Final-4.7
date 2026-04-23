import 'server-only'

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

import { missingProductionUpstashEnv } from '@/lib/env/require-production-upstash-env'

import { RATE_LIMITS, type RateLimitBucket } from './config'
import { consumeInMemory } from './in-memory'

/**
 * Shared rate limiter. Upstash Redis in production, in-memory fallback in
 * dev + CI.
 *
 * Decision locked 2026-04-20 in `KNOWN_GAPS.md`: Upstash Redis + `@upstash/ratelimit`
 * with `Ratelimit.fixedWindow(...)`. See that entry for the rationale vs
 * pg_rate_limit, Vercel KV, and other alternatives.
 *
 * Production-configured behavior:
 *   - Module-level assertion fails hard if Upstash env vars are missing.
 *     Same pattern as `middleware.ts` from `agent-7/middleware-fail-closed` —
 *     a silently-degraded limiter was the exact failure mode the hard-blocker
 *     was opened to close.
 *   - Each bucket gets one `Ratelimit` instance with a unique key prefix.
 *   - Runtime Upstash errors (network blip, Redis down) fail open and log.
 *     Rate limiting is a best-effort defense — failing closed here would make
 *     the limiter itself a single point of failure for `/accept-invite`.
 *
 * Dev + CI behavior:
 *   - If Upstash env vars are set, uses Upstash (useful for local smoke tests).
 *   - Otherwise falls back to the in-memory limiter so tests don't need
 *     network access.
 */

// Fail-closed assertion. Runs once per cold start.
{
  const missing = missingProductionUpstashEnv()
  if (missing.length > 0) {
    throw new Error(
      `rate-limit: required Upstash env vars missing in production: ${missing.join(', ')}. ` +
        `Refusing to serve — would silently fall back to the in-memory limiter, ` +
        `which resets on cold start and multiplies across serverless instances. ` +
        `Set them in the hosting platform's environment variables and redeploy.`,
    )
  }
}

function createUpstashLimiters(): Record<RateLimitBucket, Ratelimit> | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url?.startsWith('http') || !token) return null

  const redis = new Redis({ url, token })

  const entries = Object.entries(RATE_LIMITS).map(([name, bucket]) => [
    name,
    new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(bucket.requests, bucket.upstashWindow),
      prefix: `rl:${name}`,
      analytics: false,
    }),
  ]) as Array<[RateLimitBucket, Ratelimit]>

  return Object.fromEntries(entries) as Record<RateLimitBucket, Ratelimit>
}

const upstashLimiters = createUpstashLimiters()

/**
 * Attempt to consume a token. Returns true if allowed, false if rate-limited.
 * Async because the Upstash path round-trips to Redis.
 */
export async function consume(
  name: RateLimitBucket,
  identifier: string,
): Promise<boolean> {
  if (upstashLimiters) {
    try {
      const { success } = await upstashLimiters[name].limit(identifier)
      return success
    } catch (err) {
      // Fail open on Redis errors so the limiter is never the single point of
      // failure. Sentry / structured logs surface the underlying issue.
      console.error(`rate-limit: upstash .limit() failed for bucket "${name}"`, err)
      return true
    }
  }

  return consumeInMemory(name, identifier)
}

/**
 * Test-only helper exposed so integration tests can assert which backend is
 * active under given env conditions. Not imported by any production code path.
 */
export function __activeBackendForTests(): 'upstash' | 'in-memory' {
  return upstashLimiters ? 'upstash' : 'in-memory'
}
