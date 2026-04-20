# Test factories

Factories build test data through **real code paths** — not hand-crafted SQL inserts.
A factory that bypasses our server actions tests data the application can't produce.

## Naming convention

```
tests/factories/
  facility.ts       ← createTestFacility (calls createFacilityWithFirstAdmin RPC)
  user.ts           ← inviteAndAcceptUser (goes through accept-invite flow)
  shift.ts          ← createShiftAssignment (builds schedule + shifts + assignments)
  announcement.ts   ← postAnnouncement
```

## When to use a factory vs `supabase/seed.sql`

- **Seed** = fixed reference data that every test run shares (two test facilities, three users per facility, all modules). Matches local dev seed.
- **Factory** = per-test scratch data that must not leak between tests. Use when a test needs a specific state the seed doesn't provide.

## Contract

Every factory returns a `cleanup()` function. Call it in the test's `afterEach`.
Factories never accept a `facility_id` from the caller — that parameter makes
it too easy to write a test that proves the wrong thing.
