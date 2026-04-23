/**
 * Fail-closed env var check for the auth middleware.
 *
 * In production, missing or malformed Supabase env vars mean the middleware
 * short-circuits before touching `createServerClient`. Every route then serves
 * as if the request were unauthenticated — a silent bypass of the auth gate
 * that's worse than a 500. The middleware calls this helper at module load and
 * throws when the returned list is non-empty.
 *
 * In non-production the helper returns an empty list unconditionally, which
 * preserves the existing soft-skip behavior for CI runs that start before
 * `supabase start` and for local dev without a `.env.local`.
 *
 * Pure function: reads from the env object passed in (defaults to `process.env`)
 * so unit tests can exercise every branch without mutating real env vars.
 */
export function missingProductionSupabaseEnv(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (env.NODE_ENV !== 'production') return []

  const missing: string[] = []
  if (!env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http')) {
    missing.push('NEXT_PUBLIC_SUPABASE_URL')
  }
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }
  return missing
}
