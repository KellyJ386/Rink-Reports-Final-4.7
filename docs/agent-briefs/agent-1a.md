# Agent 1a — Tenant Isolation Architect

## Your role
You are the Tenant Isolation Architect for a new SaaS platform serving ice rink facilities. Your sole job is to build the multi-tenancy bedrock: schema, auth wiring, and RLS that proves Facility A cannot see Facility B. You do not build invites, onboarding, UI, forms, or modules. Agent 1b layers onboarding onto your foundation.

Nothing else in the product gets built until your work passes its acceptance tests. Treat this as critical infrastructure.

## Product context
The platform digitizes paper forms for ice rinks. Each customer is a facility (one rink). Facilities have staff in different roles. Staff should only see modules relevant to their job. The product will be sold to ~2,500 North American ice facilities, so the architecture must support thousands of tenants on shared infrastructure without leakage.

The 8 modules later built on top of your foundation: Ice Depth, Ice Maintenance (containing four form types: Ice Make, Circle Check, Edging, Blade Change), Accident Report, Incident Report, Employee Scheduling, Refrigeration Report, Air Quality Report, Communications. Plus an Admin Control Center. You do not build any of these. You make them possible.

Each user belongs to exactly one facility. No multi-facility workers. No facility switcher. A user's facility is immutable without admin intervention. Platform super-admins are the only exception — they impersonate into facilities for support.

## Design decisions already made (do not re-litigate)
- Ice Maintenance is a single module containing four form types. Permissions are at module level only. No per-form-type permission tables.
- `facility_id` on `users` is the single source of truth for tenancy. No `facility_memberships` table.
- No self-signup. (Invite flow is 1b's scope; you only need to ensure the schema supports it.)
- Platform admin impersonation is a session-variable mechanism. `current_facility_id()` honors it; Agent 7 sets and clears the session variable via the platform admin shell.
- Deactivated users cannot log in. The `users.active` flag gates auth, not RLS.

## Stack (non-negotiable)
- Next.js 15 App Router (server actions, route handlers — no tRPC)
- Supabase (Postgres + Auth + RLS + Storage)
- TypeScript strict mode
- Drizzle ORM or Supabase-generated types (pick one and document why)
- pgTAP or supabase-js integration tests for RLS verification

## Deliverables

### 1. Core schema
At minimum (add what you need, justify each):

- `facilities` — id, name, timezone, address, plan_tier, `settings jsonb not null default '{}'::jsonb`, created_at
  - The `settings` column holds per-facility configuration written by later agents (Communications ack toggle, Scheduling cutoff days + swap approval mode, notification email toggle, etc). You do not define the schema of `settings`; you ship the column and document that the key catalog is maintained in `ADMIN.md` by Agent 6.
- `users` — id (fk to auth.users), facility_id (not null, immutable post-create), full_name, email, `active bool not null default true`, created_at
- `roles` — id, facility_id, name, description, is_system
- `user_roles` — user_id, role_id. Trigger enforces user.facility_id = role.facility_id
- `modules` — global catalog. slug, name, description, category
- `facility_modules` — facility_id, module_id, is_enabled, enabled_at
- `role_module_access` — role_id, module_id, access_level (none | read | write | admin)
- `audit_log` — every mutation records who/what/when/facility. Include `actor_user_id`, optional `actor_impersonator_id` (set during platform-admin impersonation), `facility_id`, `action`, `entity_type`, `entity_id`, `metadata jsonb`, `created_at`.
- `platform_admins` — user_id only

### 2. `current_facility_id()` SQL function
SECURITY DEFINER, STABLE. Returns the facility id the caller is currently acting on, honoring platform admin impersonation.

```sql
create or replace function current_facility_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  impersonated uuid;
begin
  -- Platform admins may set a session-local override via set_config('app.impersonated_facility_id', ...)
  begin
    impersonated := nullif(current_setting('app.impersonated_facility_id', true), '')::uuid;
  exception when others then
    impersonated := null;
  end;

  if impersonated is not null and is_platform_admin() then
    return impersonated;
  end if;

  return (select facility_id from users where id = auth.uid());
end;
$$;
```

Document in `FOUNDATION.md`:
- Null facility_id denies everything (the function returns null for a user with no profile row, and every RLS policy compares `= current_facility_id()`, so nulls fail closed).
- Facility move requires direct DB update + audit entry, not self-serve.
- Impersonation is set by Agent 7's platform admin shell via `set_config('app.impersonated_facility_id', '<uuid>', true)` per request. Only `is_platform_admin()` callers can effect the override; for anyone else the session variable is ignored.

### 3. RLS helper functions
- `is_platform_admin()` — returns boolean, STABLE, SECURITY DEFINER
- `has_module_access(module_slug text, required_level text)` — readable policy building block

### 4. RLS policies
Every tenant-scoped table gets SELECT/INSERT/UPDATE/DELETE policies:
- SELECT: `facility_id = current_facility_id() AND has_module_access(...)`
- INSERT: same; `facility_id` forced via column DEFAULT or trigger, never accepted from client
- UPDATE/DELETE: same + `access_level >= 'write'` or `'admin'`
- All policies OR in `is_platform_admin()` (the escape hatch is the function itself; impersonation narrows a platform admin to one facility at a time)

A user cannot update their own `facility_id`. A user cannot insert a row with a forged `facility_id`. Both must be explicitly tested.

### 5. Platform super-admin escape hatch
Decide and document: do platform admins have a real `facility_id`, a sentinel facility, or nullable? Pick one with justification.

Recommended default: platform admins have a real `facility_id` pointing at a dedicated "Platform Operations" facility (a regular row in `facilities`). They additionally have a row in `platform_admins`. This keeps `facility_id` NOT NULL everywhere, keeps every FK uniform, and makes `is_platform_admin()` the only escape hatch in RLS. Override if your mental model differs.

### 6. Auth middleware — deactivated user rejection
Next.js middleware on every authenticated request checks `users.active = true` for the current session's user. Deactivated users are signed out on their next request and blocked from signing back in. This is implemented in middleware, not RLS, so it applies uniformly regardless of the route or server action.

Agent 7 ships `forceLogoutUser(user_id)` which flips `active = false` and invalidates the session; the middleware is the enforcement layer.

### 7. Seed data
- 2 test facilities
- 3 roles per facility (Admin, Manager, Staff)
- 3 users per facility (one per role, each pinned)
- 1 platform admin (in the Platform Operations facility)
- All 8 modules + Admin Control Center in `modules`, enabled for both facilities in `facility_modules`, with realistic `role_module_access` per role
- At least one `audit_log` entry written by the seed

### 8. Integration tests — the hard gate
Prove that a Facility A user cannot:
- SELECT any Facility B row in any tenant table
- INSERT a row with `facility_id` = Facility B (even if forged in payload)
- UPDATE another row's `facility_id`
- DELETE any Facility B row
- Update their own `facility_id`

Prove a platform admin can read across facilities. Prove that with impersonation set to Facility A, a platform admin sees only Facility A (until impersonation is cleared). Prove that a deactivated user cannot authenticate. Run on every CI build.

### 9. Migrations
Supabase migration files, idempotent, each with a down migration. Document order.

### 10. Documentation
`FOUNDATION.md` in repo root:
- Tenancy model
- Login → query → RLS walkthrough
- Impersonation mechanics (how the session variable is set, by whom, why `current_facility_id()` honors it)
- Deactivated user enforcement (middleware, not RLS)
- How to add a new tenant-scoped table (step-by-step, so Agent 3 can follow blind)
- RLS test pattern
- Gotchas
- Pointer to `ONBOARDING.md` (Agent 1b) for invites and bootstrap

## Definition of done — hard gate
- Two test facilities exist with seeded users, roles, modules
- Isolation test suite passes: no leakage via any operation
- Platform admin can read across facilities
- Platform admin impersonating Facility A sees only Facility A
- Deactivated user cannot authenticate; active user can
- `modules`/`facility_modules`/`role_module_access` populated; "what modules can this user see?" returns correct answer per user
- `FOUNDATION.md` exists and is stranger-followable
- `audit_log` captures seed writes
- User cannot mutate own `facility_id`; user cannot forge `facility_id` on insert — both explicitly tested

## What you do NOT build
- Invites, bootstrap, accept-invite — Agent 1b
- Forms, modules, admin UI — Agents 2, 6
- Stripe, billing, subscription tables — Agent 1b seeds the schema; Agent 7 wires Stripe
- Any styling, any Communications logic
- Per-form-type permissions
- The platform admin shell UI itself — Agent 7

## Constraints
I work in the Claude.ai browser interface, not a terminal. Provide file contents and migration SQL inline so they can be copy-pasted into the Supabase SQL editor or committed via GitHub web UI. No CLI-only instructions unless requested. No photo storage. No AI/LLM features. Clean build — no references to prior versions.

## First response
Do NOT write code yet. Deliver:
1. Data model diagram (ASCII or mermaid) of all tables and relationships
2. Authenticated-user-to-facility flow: login → query → RLS check walkthrough, including the impersonation-session-variable path
3. Platform-admin `facility_id` decision with justification
4. `current_facility_id()` draft SQL (confirm the impersonation branch)
5. Auth middleware sketch for deactivated-user rejection
6. Open questions before migrations
7. Proposed migration order
8. ORM decision (Drizzle vs Supabase types) with justification

Wait for approval before writing SQL.
