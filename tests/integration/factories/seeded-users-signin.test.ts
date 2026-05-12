import { describe, expect, it } from 'vitest'

import { anonClient, SEEDED_USERS, signIn } from '../../factories/supabase-client'

/**
 * Agent 9 hardening — drift guard for seeded users.
 *
 * Every entry in SEEDED_USERS must be sign-in-able against the local Supabase
 * that `supabase/seed.sql` produces. If anyone changes an email or password
 * on one side without mirroring the change to the other, every `loginAs(...)`
 * call in the E2E suite silently breaks; under `continue-on-error: true` the
 * break hides until production launch.
 *
 * This test is cheap (six sign-ins, ~300ms on warm Supabase local) and runs
 * under the integration job, which already has `supabase start` + `supabase
 * db reset --no-seed=false` prefixes.
 */

describe('SEEDED_USERS drift guard', () => {
  const entries = Object.entries(SEEDED_USERS) as Array<
    [keyof typeof SEEDED_USERS, (typeof SEEDED_USERS)[keyof typeof SEEDED_USERS]]
  >

  for (const [key, user] of entries) {
    it(`${key} can sign in with the seeded credentials`, async () => {
      const client = anonClient()
      await expect(signIn(client, user)).resolves.toBeUndefined()

      // Double-check the session matches the expected id. Catches the case
      // where two seed rows share an email (possible after a sloppy rename)
      // and signIn succeeds against the wrong one.
      const {
        data: { user: sessionUser },
      } = await client.auth.getUser()
      expect(sessionUser?.id).toBe(user.id)
      expect(sessionUser?.email).toBe(user.email)
    })
  }
})
