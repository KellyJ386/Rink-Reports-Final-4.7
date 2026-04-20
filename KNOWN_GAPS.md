# Known gaps

The anti-amnesia doc. Everything that's **covered today**, **deferred by design**,
or **would block a prod launch if still deferred**.

Agent 9 maintains this. If you defer something with "we'll do it later," it
lands here in the same PR that defers it. If it's not here, it's not remembered.

## Review cadence

- Every PR: Agent 9 checks whether the PR introduces a new gap. If yes, update this file.
- Weekly: Agent 9 reviews this file; promotes items that now block launch into the phase-2 queue.
- Pre-launch: every row in "Would block a prod launch" must be resolved or explicitly accepted.

---

## ✅ Covered today

### Tests shipped
- Per-agent module tests under `supabase/tests/*.test.sql` (20 files, shipping with each agent's DoD)
- RLS catalog harness: `scripts/generate-rls-catalog.mjs` → `supabase/tests/20_rls_catalog.test.sql`. 32 tenant tables × 3 asserts = 96 generated assertions.
- 3 E2E priority paths: `bootstrap.spec.ts`, `form-submission.spec.ts`, `permission-gate.spec.ts`
- 1 representative Vitest unit suite (`tests/unit/scheduling/week.test.ts`)
- 1 representative integration suite (`tests/integration/settings-cascade.test.ts`)

### CI / tooling
- PR workflow with 6 jobs: lint + typecheck + client-facility-id, unit, RLS, integration, e2e (4 shards), e2e-realtime (isolated, `retries: 1`)
- Nightly workflow: full e2e + perf smoke + Stripe live + npm audit
- Weekly flaky-detect: surfaces candidates, **does not auto-quarantine**
- `check-client-facility-id.sh` blocking scan for item (1) of SECURITY_CHECKLIST.md

### Docs
- `TESTING.md` — contract
- `RLS_TEST_CATALOG.md` — coverage grid + add-new-table checklist
- `SECURITY_CHECKLIST.md` — 8 items × per-path coverage
- `KNOWN_GAPS.md` — this file
- `tests/fixtures/stripe/README.md` — fixture capture procedure
- `tests/factories/README.md` — factory vs seed guidance
- `tests/e2e/README.md` — tagging + priority paths

---

## 🟡 Deferred by design (phase-2 Agent 9 work)

Tracked sequence. Each item has a condition that must be true before it lands.

### E2E paths 4–11 (from Agent 9 brief §2)

Deferred because: writing E2E for an actively-churning module means tests
break and stop being trusted. Sequencing:

- [ ] **4. Schema edit across versions** — land after Agent 2 form-editor UI is stable for one full build cycle.
- [ ] **5. Offline submission** — land in the **same PR** as Agent 7's offline queue feature work (not before). The feature is the contract.
- [ ] **6. Ice Depth session** — land after Agent 4's trends chart has a stable DOM (`recharts` selectors are fragile).
- [ ] **7. Schedule publish** — Agent 5 is Phase-1 complete; ready to land in Agent 9 phase-2 pass.
- [ ] **8. Swap flow** — ready to land phase-2; pair with perf smoke on a realistic shift volume.
- [ ] **9. Stripe trial → active** — requires committed `tests/fixtures/stripe/*.json` (captured via `stripe trigger`; see fixture README).
- [ ] **10. Communications urgent (Realtime)** — `@realtime` tag; lands in `e2e-realtime` job. Agent 8 is complete; ready.
- [ ] **11. Permission gate (already 50% covered)** — `permission-gate.spec.ts` covers `/admin/*` and manager-only scheduling. Need to extend for `/modules/communications` admin-gated sub-routes and cross-facility forgery attempts via URL manipulation.

### RLS per-operation coverage expansion

The current generator emits **SELECT-attack + policy-exists** assertions for
all 32 tenant tables. Per-operation attacks (INSERT with forged `facility_id`,
UPDATE that moves a row, DELETE cross-facility) live in per-module pgTAP
files today and are uneven:

- **Strong coverage**: `02_tenant_isolation.test.sql`, `07_facility_invites.test.sql`, `17_agent_7.test.sql`, `18_communications.test.sql`, `19_scheduling.test.sql`, `22_agent_3_per_op_attacks.test.sql` (covers accident, incident, refrigeration, air_quality cross-facility forge-INSERT + UPDATE + DELETE)
- **Partial coverage**: `15_ice_depth.test.sql` (covers SELECT + INSERT; gaps on UPDATE/DELETE cross-facility)
- **Minimal coverage**: `13_ice_maintenance_submissions.test.sql` (covered for INSERT-forge + SELECT; per-op UPDATE/DELETE pending — tracked against this PR's follow-up).

**Next**: extend `15_ice_depth.test.sql` with cross-facility UPDATE + DELETE for `ice_depth_templates`, `ice_depth_sessions`, `ice_depth_readings`. Same template as `21_form_engine_per_op_attacks.test.sql` + `22_agent_3_per_op_attacks.test.sql`. Lower priority than the Agent 3 standalone tables (Ice Depth templates are not injury records).

### Cross-module integration tests (from Agent 9 brief §6)

Deferred because: cross-module tests are most useful when every module is
Phase-1 complete — which is the state as of this PR. Ready to write in
phase-2:

- [ ] Scheduling swap approval → atomic reassignment + notifications to both parties
- [ ] Communications post → notifications insert → bell live-updates (`@realtime`)
- [ ] Form schema publish → submission pins version → detail reads history
- [ ] Ice Depth session complete → audit log linked to session id
- [ ] Deactivated user → shift_assignments remain; not in future picker

### Offline sync edge cases (brief §5)

Lands with Agent 7's offline queue feature pass, per the directive.

- [ ] N offline submissions → reconnect → FIFO, no duplicates
- [ ] Partial sync interrupted → remainder unaffected
- [ ] Validation failure on sync → marked failed, queue continues
- [ ] Queue survives browser refresh (IndexedDB)
- [ ] Queue survives PWA install transition
- [ ] Same idempotency_key queued twice → deduped client-side

### Performance smoke (brief §7)

Requires a `scripts/seed-perf.ts` that generates realistic-volume data (10k Ice Maintenance
submissions, 52 × 8 Ice Depth readings, etc.). Warm-run assertions with 1.5×
headroom per TESTING.md.

- [ ] `scripts/seed-perf.ts`
- [ ] `tests/perf/ice-maintenance-history.perf.ts` — < 1s at 10k submissions (warm)
- [ ] `tests/perf/week-builder.perf.ts` — < 1s at 100 shifts × 20 staff (warm)
- [ ] `tests/perf/ice-depth-trends.perf.ts` — < 1s at 52 × 8 points (warm)
- [ ] `tests/perf/form-editor.perf.ts` — < 2s at 50-field schema (warm)
- [ ] `tests/perf/communications-history.perf.ts` — first page < 500ms at 500 announcements (warm)

### Type-level regression tests

Covers the "Dexie queue shape drifts from server action shape" class.

- [ ] `tests/unit/offline-queue/types.test.ts` — `expectTypeOf` asserts Dexie queue row shape matches each server action's `Input` type

### Admin-config cascade tests (brief §4)

Seven classes — one already covered (`tests/integration/settings-cascade.test.ts`
does `swap_approval_mode`). Remaining six:

- [ ] Option added to shared `option_lists` → form dropdown shows it on next render
- [ ] Form schema field renamed + published → next render shows new label; historical detail shows old
- [ ] Module disabled for role → sidebar entry gone on next navigation; direct route 404
- [ ] User deactivated → logged out next request; login rejected
- [ ] `default_expiry_days` changed → next announcement uses new default
- [ ] Module enabled → default schema seeded → form renders

---

## 🔴 Would block a prod launch if still deferred

Items that must be resolved before public launch. Promoting anything into this
list is Agent 9's job; resolving items is the owning agent's.

### Hard blockers

- [ ] **Integration + E2E + E2E-Realtime jobs are `continue-on-error: true` in `.github/workflows/pr.yml`.** The jobs run and surface failures, but do not gate merge. This is a temporary compromise shipped with Agent 9 phase-1. Graduation criteria to remove `continue-on-error`:
  - Test-facility fixtures via real-auth-flow factories (not raw-SQL bcrypt seed inserts, which are fragile across Supabase CLI versions)
  - Deterministic UI label selectors — currently E2E tests bind to `getByLabel(/email/i)` etc., which are stable enough for today's shell but would break if any module agent renames a form field
  - Seeded password-grant sign-in verified against the same CLI version CI uses
  Owner: Agent 9 phase-2. **Must flip to blocking before production launch.**
- [ ] **Rate limiting is single-instance in-memory.** `/api/accept-invite` uses an in-memory token bucket; a multi-instance deploy loses the guarantee. Owner: Agent 7. Acceptance: Upstash-backed or equivalent shared limiter on at least `/accept-invite`, `/api/stripe/webhook`, and any future high-value endpoint.
- [ ] **Stripe fixture files are not yet committed.** `tests/fixtures/stripe/README.md` documents the capture process but the JSON files are absent. Without them, the phase-2 "Stripe trial → active" E2E can't land. Owner: Agent 7 (first Stripe integration pass).
- [ ] **No realistic-volume perf seed.** `scripts/seed-perf.ts` doesn't exist. Without it, perf regressions ship silently.
- [ ] **Cross-cutting `auth.uid()` RLS planner hint.** Agent 8's performance advisor findings noted that 5 policies on `announcements` / `announcement_reads` used `auth.uid()` directly; this was fixed for those tables in `20260425000005_announcements_perf.sql`. The same issue almost certainly exists on other modules' policies but has not been audited. Owner: Agent 9 + module owners. Acceptance: a scripted audit of all `pg_policies.qual` + `with_check` expressions flagging bare `auth.uid()` calls.
- [ ] **Cross-cutting `SET search_path` on trigger functions.** 15 trigger functions (pre-existing, across all prior agents) are flagged `function_search_path_mutable` by Supabase's security advisor. Low-severity WARN but real. Owner: rotating. Acceptance: one migration that `ALTER FUNCTION ... SET search_path = public, pg_temp` on all 15.

### Soft blockers (acceptable at launch with explicit sign-off)

- [ ] Minors-compliance enforcement absent from Scheduling. Documented gap in `SCHEDULING.md` — intentional. Acceptable at launch; flag for customers who employ minors.
- [ ] No visual regression tests. By design (`agent-9.md` decisions-made). Acceptable at launch.
- [ ] Offline queue tests land with the feature, not before. Acceptable.

---

## Process: how items move

- **New gap detected → straight to the appropriate section of this doc + linked in the PR description.**
- **Deferred item's gating condition becomes true → Agent 9 files a tracking issue + begins work.**
- **Gap resolved → strike through + note the PR that resolved it; keep it here for one review cycle so future agents see the audit trail; then archive to a git-history comment.**
- **Gap reclassified from "deferred" to "would block launch" → agent 9 escalates in the weekly review.**

If this file has not been touched in 30 days, that's itself a signal — either
we've forgotten to update it, or we've shipped nothing that introduced or
resolved a gap. Both are worth investigating.
