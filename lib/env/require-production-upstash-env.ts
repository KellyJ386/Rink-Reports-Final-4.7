/**
 * Fail-closed env var check for the shared rate limiter.
 *
 * In production, missing Upstash env vars mean the rate limiter silently falls
 * back to the in-memory token bucket — the exact state the Agent 9 hard-blocker
 * was opened to close. `lib/rate-limit/limiter.ts` calls this at module load
 * and throws when the returned list is non-empty.
 *
 * In non-production the helper returns an empty list unconditionally, which
 * keeps dev + CI working without a live Upstash instance (the limiter falls
 * back to in-memory in that case). Tests exercise the fallback path directly
 * without needing network access.
 *
 * Pure function: reads from the env object passed in (defaults to `process.env`)
 * so unit tests can exercise every branch without mutating real env vars.
 */
export function missingProductionUpstashEnv(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (env.NODE_ENV !== 'production') return []

  const missing: string[] = []
  if (!env.UPSTASH_REDIS_REST_URL?.startsWith('http')) {
    missing.push('UPSTASH_REDIS_REST_URL')
  }
  if (!env.UPSTASH_REDIS_REST_TOKEN) {
    missing.push('UPSTASH_REDIS_REST_TOKEN')
  }
  return missing
}
