import { describe, it, expect, beforeAll } from 'vitest'

import { anonClient, SEEDED_USERS, signIn } from '../../factories/supabase-client'

/**
 * Performance smoke — ice_maintenance_submissions history.
 *
 * Target: first 50-row page of history loads under 1s warm at the
 * realistic-volume seed of 10,000 submissions. Per TESTING.md:
 *   - Warm-run assertion only — discard the cold first run.
 *   - 1.5× headroom — fail at > 1500ms, not > 1000ms.
 *
 * Why warm-run: cold-start variance is a CI environment artifact (bytecode
 * caches, connection pools, JIT warm-up). Warm performance is what users
 * experience. The 1.5× absorbs CI noise without hiding real regressions.
 *
 * What this proves: the history query path (RLS predicate eval + facility
 * scoping + pagination + ordering) stays sub-second at production-realistic
 * volume. A regression here would be one of:
 *   - missing index on (facility_id, submitted_at desc)
 *   - RLS policy change that defeats index usage
 *   - new join that lacks a covering index
 *
 * Prerequisite: `npm run seed:perf` has been run since the last
 * `supabase db reset`. Without the seed, the assertion still passes (small
 * data set is fast) — this is documented as "perf tests require seed".
 *
 * NOT a load test. NOT a stress test. A regression-detection assertion that
 * the warm path didn't get an order of magnitude slower.
 */

const HARD_BUDGET_MS = 1500 // 1.5× the 1000ms target per TESTING.md

describe('Perf — ice_maintenance_submissions history', () => {
  let supabase: ReturnType<typeof anonClient>

  beforeAll(async () => {
    supabase = anonClient()
    await signIn(supabase, SEEDED_USERS.alphaAdmin)
  })

  async function runQuery(): Promise<number> {
    const t0 = performance.now()
    const { error } = await supabase
      .from('ice_maintenance_submissions')
      .select('id, form_type, submitted_at, submitted_by', { count: 'exact' })
      .order('submitted_at', { ascending: false })
      .range(0, 49) // first page of 50
    if (error) throw new Error(`history query failed: ${error.message}`)
    return performance.now() - t0
  }

  it('first 50-row page completes within 1.5× target on a warm run', async () => {
    // Cold run — discard. Triggers any first-time connection / planner-cache
    // setup that would inflate the measurement.
    await runQuery()

    // Warm run — assert
    const warmMs = await runQuery()

    expect(warmMs).toBeLessThan(HARD_BUDGET_MS)

    // Surface the timing in the test output so trends are visible across
    // CI runs even when the assertion passes.
    console.log(`[perf] ice_maintenance history first-page: ${warmMs.toFixed(1)}ms (budget ${HARD_BUDGET_MS}ms)`)
  })

  it('paged scan over 200 rows stays under budget', async () => {
    // Warm-up
    await supabase.from('ice_maintenance_submissions').select('id').range(0, 199)

    const t0 = performance.now()
    const { error } = await supabase
      .from('ice_maintenance_submissions')
      .select('id, form_type, submitted_at')
      .order('submitted_at', { ascending: false })
      .range(0, 199)
    if (error) throw new Error(`paged scan failed: ${error.message}`)
    const warmMs = performance.now() - t0

    expect(warmMs).toBeLessThan(HARD_BUDGET_MS)
    console.log(`[perf] ice_maintenance 200-row scan: ${warmMs.toFixed(1)}ms (budget ${HARD_BUDGET_MS}ms)`)
  })
})
