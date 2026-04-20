import { describe, it, expect, beforeEach } from 'vitest'

import { anonClient, SEEDED_USERS, serviceClient, signIn } from '../factories/supabase-client'

/**
 * Agent 9 — integration test template (cross-module cascade).
 *
 * Classic Admin-config-cascade class: change `scheduling.swap_approval_mode`
 * via the settings writer → the change is visible to the next settings read
 * on the SAME facility and NOT to another facility's reads. This covers
 * Deliverable 4 item 6 in miniature and establishes the pattern for the
 * remaining 6 cascade tests.
 *
 * Why integration (not unit): the writer path touches RLS, auth, the
 * facilities.settings JSONB column, and the zod-validator gate in a single
 * action. Mocking any of those would test a different product.
 */

describe('Settings cascade (scheduling.swap_approval_mode)', () => {
  beforeEach(async () => {
    // Reset to default via service role so each test starts from a known state
    const svc = serviceClient()
    for (const fid of [
      SEEDED_USERS.alphaAdmin.facility_id,
      SEEDED_USERS.betaAdmin.facility_id,
    ]) {
      await svc
        .from('facilities')
        .update({ settings: {} })
        .eq('id', fid)
    }
  })

  it('alpha admin flipping swap_approval_mode is visible to alpha reads and invisible to beta', async () => {
    const alpha = anonClient()
    await signIn(alpha, SEEDED_USERS.alphaAdmin)

    // Write via the real facilities.update path; RLS enforces facility match.
    const { error: writeErr } = await alpha
      .from('facilities')
      .update({ settings: { scheduling: { swap_approval_mode: 'free' } } })
      .eq('id', SEEDED_USERS.alphaAdmin.facility_id)
    expect(writeErr).toBeNull()

    // Alpha reads new value
    const { data: alphaReadData } = await alpha
      .from('facilities')
      .select('settings')
      .eq('id', SEEDED_USERS.alphaAdmin.facility_id)
      .maybeSingle()
    expect(
      (alphaReadData?.settings as { scheduling?: { swap_approval_mode?: string } } | null)
        ?.scheduling?.swap_approval_mode,
    ).toBe('free')

    // Beta reads its own facility — must still be at default
    const beta = anonClient()
    await signIn(beta, SEEDED_USERS.betaAdmin)

    const { data: betaReadData } = await beta
      .from('facilities')
      .select('settings')
      .eq('id', SEEDED_USERS.betaAdmin.facility_id)
      .maybeSingle()
    expect(
      (betaReadData?.settings as { scheduling?: { swap_approval_mode?: string } } | null)
        ?.scheduling?.swap_approval_mode,
    ).toBeUndefined()
  })

  it('non-admin staff cannot update facility settings', async () => {
    const staff = anonClient()
    await signIn(staff, SEEDED_USERS.alphaStaff)

    const { data, error } = await staff
      .from('facilities')
      .update({ settings: { scheduling: { swap_approval_mode: 'free' } } })
      .eq('id', SEEDED_USERS.alphaStaff.facility_id)
      .select()

    // Staff's UPDATE is RLS-filtered; no rows returned + no error is the
    // PostgREST shape. Either way: the setting must remain at default.
    expect(Array.isArray(data) ? data.length : 0).toBe(0)

    // Read back — still default
    const { data: check } = await staff
      .from('facilities')
      .select('settings')
      .eq('id', SEEDED_USERS.alphaStaff.facility_id)
      .maybeSingle()
    expect(
      (check?.settings as { scheduling?: { swap_approval_mode?: string } } | null)?.scheduling
        ?.swap_approval_mode,
    ).toBeUndefined()

    // Suppress unused-variable lint
    void error
  })
})
