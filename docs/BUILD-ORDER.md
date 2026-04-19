# Build Order & Back-Patch Ledger

## Dependency map

```
            ┌──────────────────────────────── Agent 9 (QA) ──────────────────────────→
            │                   runs continuously from 1a onward
            │
   1a ──→ 1b ──→ 2 ──┬──→ 3 ──┐
                     ├──→ 4 ──┤
                     ├──→ 6* ─┤
                     └──→ 7 ──┤
                              │
                              ├──→ 5 ──┐
                              └──→ 8 ──┤
                                       │
                              6* finishes (per-module admin pages)
```

`6*` ships iteratively: cross-cutting parts (users, invites, roles, modules, resources, forms, option lists, audit, billing) ship in Phase 3; per-module admin pages (Communications, Scheduling) wait for those modules to land.

## Phase-by-phase

### Phase 1 — Foundation (strictly serial)

**Agent 1a — Tenant Isolation Architect**
- Blocks: everything
- Hard gate: isolation test suite green; Facility A cannot touch Facility B via any operation; impersonation works; deactivated user blocked at auth
- Shipped includes: `facilities` with `settings jsonb`; `users` with `active`; `current_facility_id()` with impersonation awareness; auth middleware rejecting deactivated users

**Agent 1b — Onboarding Architect**
- Runs after: 1a green
- Blocks: 2, 3, 4, 5, 6, 7, 8
- Hard gate: invite + bootstrap tests green; `ONBOARDING.md` complete
- Shipped includes: `facility_invites`, `module_default_schemas`, `facility_resources`, `facility_subscriptions` (skeleton), `enableModule`, `createFacilityWithFirstAdmin` (creates trialing subscription + seeds default schemas)

### Phase 2 — Engine (strictly serial)

**Agent 2 — Form Engine Architect**
- Runs after: 1b green
- Blocks: 3, 4, 6
- Hard gate: Circle Check live end-to-end at `/modules/ice-maintenance/circle-check`; meta-schema rejects bad form_schemas; draft/publish/version/history loop proven
- Shipped includes: form engine with `/modules/<slug>/...` universal route convention; option source DSL supporting `from_resource_type`

### Phase 3 — Modules + cross-cutting (parallel once 2 is green)

**Agent 3 — Module Factory**
- Runs after: 2 green
- Hard gate: 7 modules live at `/modules/<slug>/*`; 7 sanity tests + 4 engine-integration tests pass

**Agent 4 — Ice Depth Module**
- Runs after: 2 green
- Hard gate: template publish, session run, detail view, trend chart, version pinning all proven

**Agent 6 — Admin Control Center (ships iteratively)**
- Runs after: 2 green for the form schema editor piece
- Hard gate (Phase 3 scope): cross-cutting admin live — users, invites, roles, modules, resources, forms editor, option lists, billing surface, audit log. Per-module config pages deferred to Phase 5.

**Agent 7 — Platform Engineer**
- Runs after: at least one submission table exists (once 3 starts)
- Blocks: 5's notification delivery, 8 entirely
- Hard gate: offline sync across all modules; PWA installs; Stripe trial → checkout → active; notifications table live + in-app + Realtime + email; platform admin shell; impersonation; force-logout

### Phase 4 — Custom modules (parallel; both depend on 7's notifications)

**Agent 5 — Employee Scheduling**
- Runs after: 7's notifications live (or stubs until 7 completes)
- Hard gate: build-publish-view loop; availability (recurring + overrides); time-off; swap flows (branches on `swap_approval_mode`); bulk copy; RLS across all 7 scheduling tables

**Agent 8 — Communications**
- Runs after: 7's notifications live (can start design sooner with stubs)
- Hard gate: post + Realtime + ack + read receipts + expiry + edit-lock; RLS cross-facility; markdown sanitization rejects XSS

### Phase 5 — Completion

**Agent 6 (resumption)** — per-module admin config pages
- Runs after: 5 and 8 ship
- Hard gate: `/admin/communications` and `/admin/scheduling` work

### Continuous — Agent 9 — QA

Starts the moment 1a delivers; never stops. Reviews every PR. Maintains RLS catalog, security checklist, E2E critical paths, admin config cascade tests, cross-module integration tests, performance smokes, flaky quarantine.

## Back-patches folded into revised briefs

All back-patches from the original per-agent drafts are already folded into the briefs in `docs/agent-briefs/`. Summary of what moved where:

| # | Landed in | What |
|---|---|---|
| 1 | 1b | `module_default_schemas` table (global; default schema store for modules) |
| 2 | 1b | `enableModule(facility_id, module_slug)` server action that seeds `form_schemas` from defaults |
| 3 | 1b | `createFacilityWithFirstAdmin` extended to call `enableModule` for default bundle |
| 4 | 1b | `facility_resources` table (per-facility entities: surfaces, compressors, zambonis, air-quality devices, shift positions) |
| 5 | 2 | Route convention `/modules/<slug>/...` universal; Circle Check at `/modules/ice-maintenance/circle-check` |
| 6 | 2 | Option source DSL: `{ from_resource_type: "<type>" }` reading `facility_resources` |
| 7 | 1a | `facilities.settings jsonb default '{}'` column; key catalog documented in `ADMIN.md` by Agent 6 |
| 8 | 1a | `current_facility_id()` honors session `impersonated_facility_id` when caller is platform admin; `FOUNDATION.md` documents impersonation |
| 9 | 1a | Auth middleware rejects `users.active = false` |
| 10 | 1b | `createFacilityWithFirstAdmin` creates `facility_subscriptions` row with `status = 'trialing'`, `trial_end = now() + 30d`; 1b ships the skeleton schema, 7 adds Stripe wiring |

## Suggested execution sequence

1. Run Agent 1a. Wait for green gate.
2. Run Agent 1b. Wait for green gate.
3. Run Agent 2. Wait for green gate.
4. Run Agents 3, 4, 6 (cross-cutting), 7 in parallel.
5. Run Agents 5 and 8 once Agent 7's notifications land.
6. Finish Agent 6's per-module admin pages (`/admin/scheduling`, `/admin/communications`).
7. Agent 9 runs continuously throughout.

## What to watch for

- **`facility_resources` is the most cross-cutting new table.** Touched by surfaces (Ice Depth, Ice Maintenance), compressors (Refrigeration), shift positions (Scheduling), air-quality devices. Agent 1b must ship it cleanly.
- **Notifications table timing.** Agent 5 and 8 both publish to it. If 7 ships late, both need stub-to-pending-table contracts exercised.
- **Impersonation amendment.** Affects every RLS policy's behavior. Agent 9's RLS regression suite must include impersonation cases from day one.
- **`facilities.settings` catalog.** With 6, 7, and 8 writing to it, an undocumented key will appear eventually. Agent 6's `ADMIN.md` owns the catalog of known keys.
- **`swap_approval_mode` default is `manager_approval`.** Flipping to `free` bypasses the manager approval step; tests must cover both paths.
