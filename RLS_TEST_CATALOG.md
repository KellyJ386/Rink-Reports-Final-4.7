# RLS test catalog

Source of truth for every tenant-scoped table the product's RLS protects.

## How this file relates to `supabase/tests/20_rls_catalog.test.sql`

`supabase/tests/20_rls_catalog.test.sql` is **generated** by
`scripts/generate-rls-catalog.mjs` from `tests/rls-catalog/tables.json`.

When you add a new tenant-scoped table:

1. Add a row to `tests/rls-catalog/tables.json`
2. Run `npm run rls:generate`
3. Commit both `tables.json` and the regenerated `20_rls_catalog.test.sql`
4. Update this doc's coverage grid below

CI fails if `20_rls_catalog.test.sql` is out of date relative to
`tables.json`. That's deliberate — a silent skip of a new table is exactly
the bug class Agent 9 exists to prevent.

## Coverage grid

Three assertions are generated per covered table:
1. **RLS enabled** — `pg_tables.rowsecurity` is true
2. **Has policies** — at least one row in `pg_policies`
3. **Cross-facility SELECT attack** — beta staff sees 0 alpha rows

Per-operation attacks (forged-INSERT, UPDATE-own-facility, UPDATE-other-facility,
DELETE) are covered in each module's dedicated pgTAP file. See
`KNOWN_GAPS.md` → "RLS per-operation coverage" for the phase-2 sequence.

### Covered (32)

| Table | Owning agent | Covered in dedicated file |
|---|---|---|
| `facilities` | Agent 1a | `02_tenant_isolation.test.sql` |
| `users` | Agent 1a | `02_tenant_isolation.test.sql` |
| `roles` | Agent 1a | `05_system_role_protection.test.sql` |
| `user_roles` | Agent 1a | `02_tenant_isolation.test.sql` |
| `facility_modules` | Agent 1a | `08_enable_module.test.sql` |
| `role_module_access` | Agent 1a | `14_module_sanity.test.sql` |
| `audit_log` | Agent 1a | `02_tenant_isolation.test.sql` |
| `facility_invites` | Agent 1b | `07_facility_invites.test.sql` |
| `facility_resources` | Agent 1b | `06_facility_resources.test.sql` |
| `form_schemas` | Agent 2 | `12_form_schemas.test.sql` |
| `form_schema_history` | Agent 2 | `12_form_schemas.test.sql` |
| `option_lists` | Agent 2 | `11_option_lists.test.sql` |
| `option_list_items` | Agent 2 | `11_option_lists.test.sql` |
| `ice_maintenance_submissions` | Agent 2 / 3 | `13_ice_maintenance_submissions.test.sql` |
| `accident_submissions` | Agent 3 | `14_module_sanity.test.sql` (positive insert + SELECT isolation) + `22_agent_3_per_op_attacks.test.sql` (forge INSERT + UPDATE + DELETE cross-facility) |
| `incident_submissions` | Agent 3 | `14_module_sanity.test.sql` + `22_agent_3_per_op_attacks.test.sql` |
| `refrigeration_submissions` | Agent 3 | `14_module_sanity.test.sql` + `22_agent_3_per_op_attacks.test.sql` |
| `air_quality_submissions` | Agent 3 | `14_module_sanity.test.sql` + `22_agent_3_per_op_attacks.test.sql` |
| `ice_depth_templates` | Agent 4 | `15_ice_depth.test.sql` |
| `ice_depth_template_history` | Agent 4 | `15_ice_depth.test.sql` |
| `ice_depth_sessions` | Agent 4 | `15_ice_depth.test.sql` |
| `ice_depth_readings` | Agent 4 | `15_ice_depth.test.sql` |
| `schedules` | Agent 5 | `19_scheduling.test.sql` |
| `shifts` | Agent 5 | `19_scheduling.test.sql` |
| `shift_assignments` | Agent 5 | `19_scheduling.test.sql` |
| `availability_templates` | Agent 5 | `19_scheduling.test.sql` |
| `availability_overrides` | Agent 5 | `19_scheduling.test.sql` |
| `time_off_requests` | Agent 5 | `19_scheduling.test.sql` |
| `shift_swap_requests` | Agent 5 | `19_scheduling.test.sql` |
| `announcements` | Agent 8 | `18_communications.test.sql` |
| `announcement_reads` | Agent 8 | `18_communications.test.sql` |
| `facility_subscriptions` | Agent 7 | `10_facility_subscriptions.test.sql` |

### Intentionally skipped (7) — documented, not forgotten

| Table | Reason |
|---|---|
| `notifications` | User-scoped not facility-scoped. Tested via `17_agent_7.test.sql`. |
| `billing_events` | Platform-admin only. Tested via `17_agent_7.test.sql`. |
| `impersonation_sessions` | Platform-admin only. Tested via `17_agent_7.test.sql`. |
| `scheduled_job_runs` | Platform-admin read-only. Tested via `17_agent_7.test.sql` + `18_communications.test.sql`. |
| `modules` | Global read-only catalog. Not tenant-scoped. |
| `platform_admins` | Platform-admin only. Tested via `03_platform_admin.test.sql`. |
| `module_default_schemas` | Global read-only catalog. Not tenant-scoped. |

## Adding a new tenant table — checklist

- [ ] Migration adds `alter table <t> enable row level security;`
- [ ] Migration defines SELECT + INSERT + UPDATE + DELETE policies
- [ ] INSERT policy: `facility_id` defaulted from `current_facility_id()`, never from client payload
- [ ] Module-specific pgTAP file covers the six operation attacks (forge facility_id, cross-tenant SELECT/UPDATE/DELETE, etc.)
- [ ] Row added to `tests/rls-catalog/tables.json`
- [ ] `npm run rls:generate` re-run; `supabase/tests/20_rls_catalog.test.sql` diff is committed
- [ ] This doc's coverage grid updated

The combination of the generator harness + module-specific tests + this
checklist is what stops a 38th-table forgotten-RLS bug from ever shipping.

## What the harness catches vs what it doesn't

**Catches:**
- RLS forgotten entirely (rowsecurity=false)
- Policies missing for a table
- Cross-facility SELECT leaks for the common case (direct facility_id column or inherited via FK)

**Doesn't catch (by design — covered in per-module pgTAP):**
- INSERT with a forged `facility_id` — requires knowing each table's NOT NULL columns to build a valid payload
- UPDATE that tries to move a row to another facility — requires knowing each table's update policy shape
- DELETE cross-facility — requires knowing the primary key

This split is deliberate. A harness that tries to be 100% generic either
emits trivial SQL that doesn't exercise real constraints, or becomes a
per-table configuration file masquerading as a generator. The current
harness is the genuinely generic subset; the per-module files handle the
table-shape specifics.

## Seeded users for RLS attacks

`scripts/generate-rls-catalog.mjs` assumes the following fixed UUIDs from
`supabase/seed.sql`:

```
Facility Alpha: 00000001-0000-0000-0000-000000000001
  alpha staff:  00000001-0000-0000-0000-000000001003

Facility Beta:  00000002-0000-0000-0000-000000000002
  beta staff:   00000002-0000-0000-0000-000000002003
```

These are load-bearing constants. If the seed ever renames or re-uuids
them, the generator's output drifts from reality. The seed is the source of
truth — update the generator's constants only if the seed changes.
