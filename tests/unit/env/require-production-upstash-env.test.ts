import { describe, it, expect } from 'vitest'

import { missingProductionUpstashEnv } from '@/lib/env/require-production-upstash-env'

/**
 * Agent 7 hardening — unit coverage for the rate limiter's fail-closed env check.
 *
 * Parallels `require-production-supabase-env.test.ts` but for the Upstash Redis
 * env vars consumed by `lib/rate-limit/limiter.ts`. The helper returns an empty
 * list outside production so dev + CI can fall back to the in-memory limiter
 * without error, and reports any missing/malformed vars in production so the
 * rate-limit module throws at load.
 */

function env(
  overrides: Partial<
    Record<'NODE_ENV' | 'UPSTASH_REDIS_REST_URL' | 'UPSTASH_REDIS_REST_TOKEN', string>
  >,
): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv
}

describe('missingProductionUpstashEnv — non-production soft-skip', () => {
  it('returns empty when NODE_ENV is test and nothing is set', () => {
    expect(missingProductionUpstashEnv(env({ NODE_ENV: 'test' }))).toEqual([])
  })

  it('returns empty when NODE_ENV is development and nothing is set', () => {
    expect(missingProductionUpstashEnv(env({ NODE_ENV: 'development' }))).toEqual([])
  })

  it('returns empty when NODE_ENV is unset and nothing is set', () => {
    expect(missingProductionUpstashEnv(env({}))).toEqual([])
  })
})

describe('missingProductionUpstashEnv — production hard-fail', () => {
  it('reports both vars when neither is set', () => {
    expect(missingProductionUpstashEnv(env({ NODE_ENV: 'production' }))).toEqual([
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
    ])
  })

  it('reports only the URL when only the token is set', () => {
    expect(
      missingProductionUpstashEnv(
        env({ NODE_ENV: 'production', UPSTASH_REDIS_REST_TOKEN: 'tok' }),
      ),
    ).toEqual(['UPSTASH_REDIS_REST_URL'])
  })

  it('reports only the token when only the URL is set', () => {
    expect(
      missingProductionUpstashEnv(
        env({
          NODE_ENV: 'production',
          UPSTASH_REDIS_REST_URL: 'https://eu1-something.upstash.io',
        }),
      ),
    ).toEqual(['UPSTASH_REDIS_REST_TOKEN'])
  })

  it('returns empty when both are set with an https URL', () => {
    expect(
      missingProductionUpstashEnv(
        env({
          NODE_ENV: 'production',
          UPSTASH_REDIS_REST_URL: 'https://eu1-something.upstash.io',
          UPSTASH_REDIS_REST_TOKEN: 'tok',
        }),
      ),
    ).toEqual([])
  })

  it('rejects a URL that does not start with http', () => {
    expect(
      missingProductionUpstashEnv(
        env({
          NODE_ENV: 'production',
          UPSTASH_REDIS_REST_URL: 'eu1-something.upstash.io',
          UPSTASH_REDIS_REST_TOKEN: 'tok',
        }),
      ),
    ).toEqual(['UPSTASH_REDIS_REST_URL'])
  })

  it('rejects an empty token', () => {
    expect(
      missingProductionUpstashEnv(
        env({
          NODE_ENV: 'production',
          UPSTASH_REDIS_REST_URL: 'https://eu1-something.upstash.io',
          UPSTASH_REDIS_REST_TOKEN: '',
        }),
      ),
    ).toEqual(['UPSTASH_REDIS_REST_TOKEN'])
  })
})
