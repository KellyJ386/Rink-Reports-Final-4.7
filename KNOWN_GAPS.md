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

- [x] **4. Schema edit across versions** — **shipped via Agent 2 engine-hardening** (`tests/e2e/schema-edit-across-versions.spec.ts`). Form-editor UI stable as of commit `c8f1224` Agent 6 Phase 5.
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

- **Strong coverage**: `02_tenant_isolation.test.sql`, `07_facility_invites.test.sql`, `17_agent_7.test.sql`, `18_communications.test.sql`, `19_scheduling.test.sql`, `21_form_engine_per_op_attacks.test.sql` (covers `form_schemas`, `option_list_items`, `ice_maintenance_submissions` cross-facility UPDATE + DELETE), `22_agent_3_per_op_attacks.test.sql` (covers accident, incident, refrigeration, air_quality cross-facility forge-INSERT + UPDATE + DELETE)
- **Partial coverage**: `15_ice_depth.test.sql` (covers SELECT + INSERT; gaps on UPDATE/DELETE cross-facility)
- **Minimal coverage**: `13_ice_maintenance_submissions.test.sql` (covered for INSERT-forge + SELECT; per-op UPDATE/DELETE pending — tracked as follow-up).

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

Seed + warm-run pattern shipped via `agent-9/perf-seed-foundation` PR. Remaining
scenarios land per-PR using the same template as
`tests/integration/perf/ice-maintenance-history.perf.test.ts`. Warm-run with
1.5× headroom per TESTING.md.

- [x] **`scripts/seed-perf.ts`** — local-only seeder; idempotent on `idempotency_key`. 10k Ice Maintenance submissions, 52 sessions × 8 Ice Depth readings, 100 shifts, 500 announcements. Refuses to run against non-local URLs.
- [x] **`tests/integration/perf/ice-maintenance-history.perf.test.ts`** — warm-run assertion under 1.5s, plus 200-row paged scan.
- [ ] `tests/integration/perf/week-builder.perf.test.ts` — < 1.5s at 100 shifts × 20 staff (warm). Seed-side: shifts already there; assignments would graduate to test if needed.
- [ ] `tests/integration/perf/ice-depth-trends.perf.test.ts` — < 1.5s at 52 × 8 points (warm).
- [ ] `tests/integration/perf/form-editor.perf.test.ts` — < 3s at 50-field schema (warm). Seed-side: needs a 50-field draft schema; trivial extension to seed-perf.
- [ ] `tests/integration/perf/communications-history.perf.test.ts` — first page < 750ms at 500 announcements (warm).

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
- [ ] **Rate limiting is single-instance in-memory.** `/api/accept-invite` uses an in-memory token bucket; a multi-instance deploy loses the guarantee.
  - **Decision locked (2026-04-20):** **Upstash Redis** + `@upstash/ratelimit`. Rationale:
    - Smallest surface — two env vars (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) + one package (~20 lines of glue at the limited-endpoint level).
    - **Single vendor relationship** — `@upstash/qstash` is already in our dependency list for scheduled jobs, so this adds no new provider.
    - Free tier (10k requests/day) is 2–3× the combined projected volume of `/accept-invite` + `/api/stripe/webhook` for the first 1,000 facilities.
    - Reversible — swapping to a different KV provider (Redis Cloud, Vercel KV, a pg_rate_limit function) is a 5-line change at the `Ratelimit.fixedWindow(...)` call site. Low lock-in cost.
    - Rejected alternatives:
      - **`pg_rate_limit` (DB function):** ties rate limiting to DB availability — if Supabase hiccups, the limiter fails open. Also adds a DB round-trip per limited request.
      - **Vercel Edge KV:** only works on Vercel; locks us deeper into the platform and leaves rate limiting broken if we ever run on a non-Vercel host.
  - **Acceptance (unchanged):** Upstash-backed or equivalent shared limiter on at least `/accept-invite`, `/api/stripe/webhook`, and any future high-value endpoint. Owner: Agent 7 in the next Agent 7 feature pass.
- [ ] **Stripe fixture files are not yet committed.** `tests/fixtures/stripe/README.md` documents the capture process but the JSON files are absent. Without them, the phase-2 "Stripe trial → active" E2E can't land. Owner: Agent 7 (first Stripe integration pass).
- [x] ~~**`loadCoreFields` dynamic-import path uses the raw slug, not the on-disk directory name.** `lib/forms/load-core-fields.ts` computes `@/app/modules/${moduleSlug}/${formType}/core-fields` where `moduleSlug` is snake_case (`ice_maintenance`, `air_quality`) but the actual directories are kebab-case (`ice-maintenance/`, `air-quality/`). Single-word modules (`accident`, `incident`, `refrigeration`) are unaffected because slug = directory. Multi-word modules and every Ice Maintenance form type may currently fail at `import()` resolution — surfaces as "core-fields module not found" at render or submit time. The Seam 3 registry (`app/modules/_registry.ts`) encodes the explicit on-disk path per (slug, formType); the fix is to consume the registry from `loadCoreFields` instead of re-deriving the path.~~ **Resolved** by the `agent-2/post-phase-2-hardening` PR. `loadCoreFields` now looks up `(moduleSlug, formType)` in the registry, parses `coreFieldsPath` into directory segments, and dynamic-imports with webpack-friendly template literals. Regression guard: `tests/unit/forms/load-core-fields.test.ts` asserts all 8 registered entries resolve (including the previously-broken `air_quality` and all four `ice_maintenance` form types).
- [ ] **Branch protection is disabled on the default branch (`main1`).** `GET /repos/.../branches` returns `protected: false` for `main1`. Evidence the gap is live, not theoretical: the April 2026 "merge storm" landed four back-to-back PRs (#24/#25/#26/#27) whose auto-merge reconciliation left `middleware.ts` with three stacked env-var guards, a duplicated `createServerClient(...)` block (tsc failed with 6 errors), and a `package-lock.json` missing `fsevents`. The fixup shipped as **three direct-to-main1 commits** (`090c33e`, `4bb5a46`, `f8ce7f6`), two of which have identical commit messages and overlapping diffs — force-push / rebase residue. Without protection, this recurs on the next merge-heavy window (e.g., Agent 2 Phase 2's three-seam landing). Acceptance: `main` requires PR + passing required status checks; direct pushes rejected for all users including admins; force-pushes to `main` rejected unconditionally. Also planned in the same admin pass: rename `main1` → `main` (safe — old `main` tip `a8d9539` is a strict ancestor of `main1`; no commits would be lost) and delete the `claude/set-main-default-branch-2OrNp` leftover. Owner: repo admin (one-time Settings → Branches action). **Must land before public launch.** Codified convention in `docs/agent-workflow.md` (no-direct-commits + merge-reconciliation sections).
- [ ] **`middleware.ts` silently bypasses auth when Supabase env vars are missing.** Current main1 `middleware.ts` early-returns the response without creating a Supabase client if `NEXT_PUBLIC_SUPABASE_URL` doesn't start with `http` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is absent. The guard exists for CI resilience (so tests that run before `supabase start` don't crash the server), but in production it means a misconfigured deployment — one where env vars failed to populate at build time or got rotated out — serves every route as if the user were unauthenticated. No "fail closed" path; no startup assertion. Acceptance: either (a) separate the CI-only guard from the production middleware (distinct entry points), or (b) fail hard on missing env vars in production builds via a startup assertion, keeping the soft-skip only under `NODE_ENV !== 'production'`. Owner: Agent 7 (platform/infra). Surfaced during Agent 2 Phase 2 pre-read of main1 diff.
- [x] ~~**No realistic-volume perf seed.** `scripts/seed-perf.ts` doesn't exist. Without it, perf regressions ship silently.~~ **Resolved** by `agent-9/perf-seed-foundation` PR. `scripts/seed-perf.ts` ships realistic volumes (10k IM submissions, 52×8 ice depth readings, 100 shifts, 500 announcements) with a local-URL safety guard. First representative perf test (`tests/integration/perf/ice-maintenance-history.perf.test.ts`) consumes it via the warm-run pattern in TESTING.md. Remaining 4 perf scenarios are tracked under "Performance smoke (brief §7)" above and land per-PR using the same template.
- [x] ~~**Cross-cutting `auth.uid()` RLS planner hint.** Agent 8's performance advisor findings noted that 5 policies on `announcements` / `announcement_reads` used `auth.uid()` directly; this was fixed for those tables in `20260425000005_announcements_perf.sql`. The same issue almost certainly exists on other modules' policies but has not been audited.~~ **Resolved** by `20260427000002_auth_uid_initplan_hoisting.sql` (Agent 9 `auth-uid-hoisting` PR). `pg_policies` scan across all 33 RLS policies in `public` found 3 remaining bare calls (2 on `notifications`, 1 on `audit_log`); all rewritten. Regression guard: `supabase/tests/23_no_bare_auth_uid_in_policies.test.sql` asserts zero bare calls on every PR. Diagnostic scan: `scripts/audit-auth-uid-in-policies.sql`.
- [x] ~~**Cross-cutting `SET search_path` on trigger functions.** 15 trigger functions (pre-existing, across all prior agents) are flagged `function_search_path_mutable` by Supabase's security advisor.~~ **Resolved** by `20260427000001_trigger_search_path_hygiene.sql` (Agent 9 `search-path-hygiene` PR). Remote advisor confirms zero remaining `function_search_path_mutable` findings post-apply.

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
