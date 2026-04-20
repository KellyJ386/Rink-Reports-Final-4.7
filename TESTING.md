# Testing

The testing contract. Read this before writing a test, before writing a
feature that needs a test, and before opening a PR.

## Layers

| Layer | Tool | Scope | Lives in |
|---|---|---|---|
| Unit | **Vitest** | Pure functions, no DB, no network | `tests/unit/**` |
| Integration | **Vitest** | Real local Supabase via CLI; RLS + server actions | `tests/integration/**` |
| RLS regression | **pgTAP** | DB-level attacks (SELECT/INSERT/UPDATE/DELETE) | `supabase/tests/*.test.sql` |
| E2E | **Playwright** | Full browser → Next → Supabase | `tests/e2e/**` |
| Type regressions | **Vitest + expectTypeOf** | Catch Dexie/queue/server-action shape drift | `tests/unit/**/*.types.test.ts` |

We do **not** mock the database layer in integration tests. We do **not**
stub Realtime. The closer tests run to production shapes, the less likely a
green CI means a broken product.

## Running locally

```bash
# All unit tests
npm run test:unit

# All integration tests (requires `supabase start` first)
supabase start
npm run test:integration

# RLS regression — spins a fresh local DB
supabase db reset
supabase test db

# E2E (all tags)
npm run test:e2e

# E2E, exclude @realtime (mirrors PR CI)
npm run test:e2e -- --grep-invert "@realtime"
```

First-time setup:

```bash
npm install
npx playwright install chromium
```

## Writing a unit test

Template: `tests/unit/scheduling/week.test.ts`. Follow it.

- Test file name matches the module: `lib/scheduling/week.ts` → `tests/unit/scheduling/week.test.ts`.
- One `describe` per exported function. One `it` per behavior.
- No network. No DB. No filesystem. No time — use `vi.useFakeTimers()` if the code touches `Date.now()`.
- Assertions are positive (`expect(x).toBe(y)`) not negative (`expect(x).not.toBe(z)`) unless proving absence is the point.

## Writing an integration test

Template: `tests/integration/settings-cascade.test.ts`. Follow it.

- Use `anonClient()` for the user-facing code path. Service role only where a factory needs cross-tenant cleanup.
- `beforeEach` resets state that the test will mutate. Don't assume seed state survives parallel runs.
- Assert both the positive and the negative: "alpha can read" AND "beta cannot".

## Writing a pgTAP test

Template: `supabase/tests/18_communications.test.sql`. Follow it.

- Use `_test_as(user_id)` to impersonate a known seed user.
- Use `reset role;` between role switches.
- Wrap in `begin;` / `rollback;` so tests don't mutate state.

## Writing an E2E test

Template: `tests/e2e/form-submission.spec.ts`. Follow it.

- Tag properly: `@realtime`, `@slow`, `@mobile`, `@a11y` — see `tests/e2e/README.md`.
- Use `loginAs(page, 'alphaStaff')` — don't roll your own login.
- Isolate by using a unique suffix in any name/email you create. Parallel shards run concurrently.
- Clean up any cross-context work (`await freshContext.close()`).

## PR requirements

1. Branch name: `agent-N/phase-N-description`.
2. PR template filled out.
3. Tests added for every mutation path introduced or modified.
4. `RLS_TEST_CATALOG.md` updated if new tenant tables were added.
5. `SECURITY_CHECKLIST.md` updated if new server actions were added.
6. CI green. Agent 9 review acknowledged.
7. Squash-merge only. The PR description becomes the commit message.

A PR without tests for its mutation paths will be sent back. A PR that adds
a tenant-scoped table without updating the RLS catalog will be sent back.

## What to do when a test fails

### Unit or integration test fails
Fix the code. Not the test.

### RLS test fails
**Stop.** A failing RLS test is a tenant-leak risk. Do not merge anything else
until the underlying policy is correct. Re-run locally against a reset DB
(`supabase db reset && supabase test db`) to confirm it's not environment noise.

### E2E test fails on PR
1. Read the Playwright report artifact — screenshot + trace.
2. Re-run locally with the same Playwright project (`npx playwright test --project chromium-default`).
3. If it reproduces: fix the code.
4. If it doesn't reproduce: do NOT skip. File an issue, tag `@flake-candidate`. The flaky-detect workflow will surface it if it recurs.

### `@realtime` E2E fails
One retry is already built in (per-project `retries: 1`). If the retry doesn't
recover, treat it as a real bug. If you see a sustained >5% flake rate across
`@realtime` tests, escalate — the fix is an investigation into Realtime
subscription setup, not a wider retry window.

## CI matrix

| Job | Where | Gate |
|---|---|---|
| lint + typecheck + client-facility-id scan | PR + push to main | Blocking |
| Vitest unit | PR + push | Blocking |
| RLS regression (pgTAP) | PR + push | **Zero-tolerance** blocking |
| Integration (Vitest + Supabase local) | PR + push | Blocking |
| E2E critical paths | PR + push (4 shards) | Blocking |
| E2E Realtime (isolated) | PR + push | Blocking (with retries: 1 on @realtime) |
| Full E2E | Nightly | Reports only; nightly failures open issues |
| Performance smoke | Nightly | Warm-run hard assertions with 1.5× headroom |
| Stripe live | Nightly | Optional (skips without STRIPE_TEST_SECRET_KEY) |
| npm audit | Nightly | Warning only (upstream advisories shouldn't red-build) |
| Flaky scan | Weekly | Surfaces candidates; manual triage |

CI budget: PR pipeline < 10 minutes wall clock. If a job consistently pushes past
its timeout, the fix is parallelization or skipping irrelevant work, not raising the budget.

### Graduation rule (continue-on-error → blocking)

Some jobs ship as `continue-on-error: true` when their underlying surface is
not yet stable enough to gate merge (initial test fixture work, UI selectors
churning across module agents, etc.). Graduating a job to blocking is **one
PR per job**, not a multi-job flip.

A job graduates when it has:

- Passed **5 consecutive PR runs** with no manual re-runs
- No documented flake history (no `flaky-detect` issue opened against any of
  its tests, no mention of re-runs in the relevant PR discussions)
- Its owning surface has not been churning in the same 5-run window (no
  feature PRs landing against the tested code without corresponding test
  updates)

**Promotion order (lowest flake risk first):**

1. Vitest unit (`unit`)
2. Vitest integration (`integration`)
3. pgTAP RLS regression expansion rows
4. Playwright E2E critical paths (`e2e`)
5. Playwright E2E Realtime (`e2e-realtime`)

Graduating in this order means we see signal from the easy ones — flake
rate, failure modes, CI-time cost — before we commit to gating merge on the
harder ones. Each graduation PR's title is
`ci: graduate <job-name> to blocking` and its body documents the 5 runs
that justified the promotion.

## Flaky quarantine

See `.github/workflows/flaky-detect.yml`. A weekly scan identifies tests that
failed ≥ 2 times in the last 7 days and opens a GitHub issue. **No automatic
quarantine.** A human (via follow-up PR) moves a confirmed-flaky test into
`tests/quarantine/` with a `TODO(flake-<issue-number>)` comment. Tests in
quarantine don't gate merge. Quarantined tests that go 14 consecutive green
runs auto-close their issue and are moved back by a follow-up PR.

## Performance smoke

Warm-run assertions only — each scenario runs twice, the first run is
discarded, the second is asserted against a target with 1.5× headroom.
Rationale: cold-start variance is a CI environment artifact. Warm performance
is what users experience.

If a warm run fails the 1.5× check, that's a real regression. It blocks
merge on nightly and reports by opening an issue against the owning agent.

## Coverage

We do not enforce a coverage percentage. A codebase with 95% coverage and the
wrong tests is worse than one with 70% coverage and the right tests. Agent 9's
review is the enforcement — "where's the test for this mutation path?" is
the question.

## When this file changes

TESTING.md is the contract. When a new convention is adopted (new tool, new
tag, new job), update this file in the same PR that adopts the change. A
convention documented only in Slack / a sticky note / institutional memory
is not a convention.
