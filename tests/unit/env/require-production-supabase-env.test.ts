import { describe, it, expect } from 'vitest'

import { missingProductionSupabaseEnv } from '@/lib/env/require-production-supabase-env'

/**
 * Agent 7 hardening — unit coverage for the middleware's fail-closed env check.
 *
 * The check replaced a silent soft-skip that would serve every route as
 * unauthenticated in a misconfigured production deploy. Coverage here proves:
 *   - non-production soft-skips regardless of what's set
 *   - production reports every missing var (ordered URL-then-anon-key)
 *   - the URL check rejects empty, non-http, and whitespace-prefixed values
 */

function env(
  overrides: Partial<Record<'NODE_ENV' | 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY', string>>,
): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv
}

describe('missingProductionSupabaseEnv — non-production soft-skip', () => {
  it('returns empty when NODE_ENV is test and nothing is set', () => {
    expect(missingProductionSupabaseEnv(env({ NODE_ENV: 'test' }))).toEqual([])
  })

  it('returns empty when NODE_ENV is development and nothing is set', () => {
    expect(missingProductionSupabaseEnv(env({ NODE_ENV: 'development' }))).toEqual([])
  })

  it('returns empty when NODE_ENV is unset and nothing is set', () => {
    expect(missingProductionSupabaseEnv(env({}))).toEqual([])
  })
})

describe('missingProductionSupabaseEnv — production hard-fail', () => {
  it('reports both vars when neither is set', () => {
    expect(missingProductionSupabaseEnv(env({ NODE_ENV: 'production' }))).toEqual([
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ])
  })

  it('reports only the URL when only the anon key is set', () => {
    expect(
      missingProductionSupabaseEnv(
        env({ NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' }),
      ),
    ).toEqual(['NEXT_PUBLIC_SUPABASE_URL'])
  })

  it('reports only the anon key when only a valid URL is set', () => {
    expect(
      missingProductionSupabaseEnv(
        env({
          NODE_ENV: 'production',
          NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        }),
      ),
    ).toEqual(['NEXT_PUBLIC_SUPABASE_ANON_KEY'])
  })

  it('returns empty when both are set with an https URL', () => {
    expect(
      missingProductionSupabaseEnv(
        env({
          NODE_ENV: 'production',
          NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
        }),
      ),
    ).toEqual([])
  })

  it('returns empty when URL is http (localhost development-over-prod-bundle)', () => {
    expect(
      missingProductionSupabaseEnv(
        env({
          NODE_ENV: 'production',
          NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
        }),
      ),
    ).toEqual([])
  })

  it('rejects a URL that does not start with http', () => {
    expect(
      missingProductionSupabaseEnv(
        env({
          NODE_ENV: 'production',
          NEXT_PUBLIC_SUPABASE_URL: 'gzzzxkvbhusvyoxlwcpd.supabase.co',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
        }),
      ),
    ).toEqual(['NEXT_PUBLIC_SUPABASE_URL'])
  })

  it('rejects a URL that is whitespace', () => {
    expect(
      missingProductionSupabaseEnv(
        env({
          NODE_ENV: 'production',
          NEXT_PUBLIC_SUPABASE_URL: '   ',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
        }),
      ),
    ).toEqual(['NEXT_PUBLIC_SUPABASE_URL'])
  })

  it('rejects an empty anon key even if URL is valid', () => {
    expect(
      missingProductionSupabaseEnv(
        env({
          NODE_ENV: 'production',
          NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
        }),
      ),
    ).toEqual(['NEXT_PUBLIC_SUPABASE_ANON_KEY'])
  })
})
