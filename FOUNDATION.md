# FOUNDATION.md

The tenant-isolation foundation for Rink Reports. Shipped by Agent 1a.

This document is the source of truth for: the tenancy model, the auth flow, RLS helper functions, impersonation, deactivated-user enforcement, the recipe for adding new tenant-scoped tables, the RLS test pattern, and known gotchas.

**Read this before touching anything.** Every downstream agent (2 through 9) assumes the rules here hold.

For onboarding, invites, and bootstrap flow, see [`ONBOARDING.md`](./ONBOARDING.md) (Agent 1b).

---

## Stack

- **Next.js 15** App Router, server actions, route handlers
- **Supabase** (Postgres + Auth + RLS + Storage)
- **TypeScript** strict mode
- **Supabase-generated types** (ORM-of-record is the DB schema; types flow from `supabase gen types typescript`; see decision in Agent 1a's brief)
- **pgTAP** for RLS regression tests

Supabase project: `https://gzzzxkvbhusvyoxlwcpd.supabase.co`.

---

## Tenancy model

**Each customer is a facility. Each user belongs to exactly one facility. There is no multi-facility worker and no facility switcher.**

- `facilities` — one row per customer rink, plus one sentinel "Platform Operations" row marked `is_platform = true`.
- `users` — profile table extending `auth.users`. `facility_id` is NOT NULL and immutable post-creation (trigger-enforced). `active` gates authentication.
- `roles` — per-facility. Role names collide across facilities freely.
- `user_roles` — join table. A trigger asserts `user.facility_id = role.facility_id`.
- `modules` — global catalog (Ice Depth, Ice Maintenance, etc.). Read-only for most; platform-admin-only writes.
- `facility_modules` — which modules each facility has enabled.
- `role_module_access` — per-role access level (`none | read | write | admin`) per module.
- `platform_admins` — users with cross-facility superpowers. One row = one platform admin.
- `audit_log` — append-only. Every mutation across the product records actor, facility, action, entity. UPDATE and DELETE blocked by trigger.

### The Platform Operations facility

A single sentinel `facilities` row with `slug = 'platform'` and `is_platform = true`. Platform admins' `users.facility_id` points here. This keeps `users.facility_id NOT NULL` uniform across the system, which means every RLS policy and FK stays simple.

**Never hardcode the Platform Operations UUID.** Reference it via:
- `public.platform_facility_id()` in SQL / RLS policies / migrations
- Its slug `'platform'` in URLs or logs if it surfaces at all

A partial unique index `one_platform_facility ON facilities ((true)) WHERE is_platform` enforces exactly-one.

---

## The four RLS helper functions

All are `STABLE SECURITY DEFINER` so they can query reference tables regardless of the caller's RLS.

### `current_facility_id() → uuid`
Returns the facility id the caller is currently acting on.

1. If session-local variable `app.impersonated_facility_id` is set **and** the caller is a platform admin, return that UUID.
2. Otherwise return `users.facility_id` for `auth.uid()`.
3. Return null for anonymous or orphaned callers. Every RLS policy compares `= current_facility_id()`, so null fails closed.

### `is_platform_admin() → bool`
True if `auth.uid()` has a row in `platform_admins`. The only escape hatch in every RLS policy.

### `platform_facility_id() → uuid`
UUID of the single `is_platform = true` facility. Reference this, not a hardcoded literal.

### `has_module_access(module_slug text, required_level text) → bool`
True if `auth.uid()` has at least `required_level` on the named module, via any of their roles. Level ordering: `none(0) < read(1) < write(2) < admin(3)`.

---

## Login → query → RLS walkthrough

### Normal authenticated request

1. User POSTs to `/login`. Supabase Auth validates credentials, sets httpOnly session cookies.
2. Next.js middleware (`middleware.ts`) runs on every request:
   - Refreshes the Supabase session.
   - If authenticated, fetches `users.active` for `auth.uid()`. Inactive → sign out + redirect to `/login?reason=deactivated`.
   - Otherwise request proceeds.
3. Server action / RSC calls Supabase with the session.
4. Postgres evaluates RLS. Policy template:
   ```sql
   facility_id = current_facility_id() AND has_module_access('<slug>', '<level>')
   ```
5. `current_facility_id()` reads `auth.uid()` → returns the user's own `facility_id` (no impersonation for regular users).
6. Row returned only if matched.

### Impersonation variant (platform admin)

1. Platform admin clicks `/platform-admin/facilities/[id]/impersonate` (route owned by Agent 7).
2. The server-side handler sets an httpOnly cookie: `impersonated_facility_id=<uuid>`.
3. On every subsequent request in an impersonation session, the Supabase client invokes `SET LOCAL app.impersonated_facility_id = '<uuid>'` at the start of the transaction.
4. `current_facility_id()` honors the session variable — **only for platform admins**. Any other caller passing the cookie is silently ignored (the `is_platform_admin()` check gates the override).
5. All `audit_log` writes during the session record `actor_impersonator_id = <platform admin user id>` in addition to `actor_user_id`, which captures the acting identity.
6. `/platform-admin/stop-impersonating` clears the cookie.

**Note:** impersonation narrows `current_facility_id()` (which gates INSERT WITH CHECK paths and serves as the DEFAULT for new rows) but does **not** narrow SELECT. Platform admins retain cross-facility read access via the `is_platform_admin()` OR branch in every policy. This is intentional — the impersonation is a UX + write-path affordance, not a visibility lock.

### Deactivated user enforcement

- `users.active` is a boolean flag. Agent 6's deactivate action flips it to `false`. Agent 7's `forceLogoutUser` does the same plus revokes the session.
- **Middleware** is the enforcement layer, not RLS. Every authenticated request checks `users.active`. Inactive users are signed out on their next request and blocked from re-login.
- RLS policies do not check `active`. An inactive user's session is already invalidated before any DB query fires; adding `active` checks to every policy would be redundant and bloat the policy surface.
- **Do not** add `users.active = true` to RLS policies. That's a scope creep for Agent 6 to rely on.

---

## How to add a new tenant-scoped table

Follow this recipe exactly. If it doesn't fit your table, stop and ask — you've probably identified a pattern gap we need to discuss.

1. **Create a migration file** under `supabase/migrations/` with timestamp + name, e.g. `20260501000001_ice_depth_sessions.sql`.

2. **Define the table.** Include `facility_id uuid not null default current_facility_id()` as the tenant key. Wire any FKs to `public.facilities(id) on delete restrict`.

3. **Enable RLS immediately:**
   ```sql
   alter table public.<your_table> enable row level security;
   ```

4. **Write four policies.** Copy the template below, replacing `<your_table>`, `<module_slug>`, and the required levels:
   ```sql
   drop policy if exists <your_table>_select on public.<your_table>;
   create policy <your_table>_select on public.<your_table>
     for select to authenticated
     using (
       public.is_platform_admin()
       or (facility_id = public.current_facility_id()
           and public.has_module_access('<module_slug>', 'read'))
     );

   drop policy if exists <your_table>_insert on public.<your_table>;
   create policy <your_table>_insert on public.<your_table>
     for insert to authenticated
     with check (
       public.is_platform_admin()
       or (facility_id = public.current_facility_id()
           and public.has_module_access('<module_slug>', 'write'))
     );

   drop policy if exists <your_table>_update on public.<your_table>;
   create policy <your_table>_update on public.<your_table>
     for update to authenticated
     using (
       public.is_platform_admin()
       or (facility_id = public.current_facility_id()
           and public.has_module_access('<module_slug>', 'write'))
     )
     with check (
       public.is_platform_admin()
       or (facility_id = public.current_facility_id()
           and public.has_module_access('<module_slug>', 'write'))
     );

   drop policy if exists <your_table>_delete on public.<your_table>;
   create policy <your_table>_delete on public.<your_table>
     for delete to authenticated
     using (
       public.is_platform_admin()
       or (facility_id = public.current_facility_id()
           and public.has_module_access('<module_slug>', 'admin'))
     );
   ```

5. **If your table has submission-style rows** (user fills a form, saves), include the standard submission columns per Agent 2's contract: `id`, `facility_id`, `submitted_by`, `submitted_at`, `form_schema_version`, `custom_fields jsonb`, `idempotency_key text` with partial unique on `(facility_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.

6. **Never accept `facility_id` from the client.** Use the column DEFAULT `current_facility_id()`. The RLS WITH CHECK will reject forged values but relying on the DEFAULT is belt-and-suspenders.

7. **Add pgTAP tests.** Copy `supabase/tests/02_tenant_isolation.test.sql` as a starting point, replace the table names, and verify:
   - Facility A user cannot SELECT Facility B rows
   - Forged `facility_id` on INSERT rejected
   - Cross-facility UPDATE affects 0 rows
   - Cross-facility DELETE affects 0 rows
   - Platform admin can read across facilities

8. **Update Agent 9's RLS catalog** (`docs/` eventually — or the test itself). New table, new rows in the coverage record.

9. **Audit log writes.** If your table's mutations need an audit trail (they probably do), write an `audit_log` row from your server action. The shape: `facility_id = current_facility_id()`, `actor_user_id = auth.uid()`, `actor_impersonator_id` left null unless set by platform-admin impersonation middleware.

---

## Running migrations and tests

### Local development (Supabase CLI)

```bash
# Start local Supabase (Postgres + Studio + Auth)
npx supabase start

# Apply all migrations + run seed.sql
npx supabase db reset

# Run pgTAP tests
npx supabase test db
```

### Pushing to the remote project

```bash
# Link to the remote project
npx supabase link --project-ref gzzzxkvbhusvyoxlwcpd

# Push migrations (DOES NOT run seed.sql — production seeding is via Agent 1b's bootstrap action)
npx supabase db push
```

`seed.sql` contains test-only data and must **never** run in production. The Supabase CLI does not push `seed.sql` via `db push` — it's only applied on `db reset` locally.

### Manual SQL Editor path (browser-only workflow)

Paste each migration file in `supabase/migrations/` into the Supabase SQL Editor **in filename order**. They are idempotent (`create table if not exists`, `create or replace function`, `on conflict do nothing`), so re-runs are safe.

Do not paste `seed.sql` into production.

---

## RLS test pattern

pgTAP tests live in `supabase/tests/`. Each file:

```sql
begin;
select plan(<N>);

-- helper to impersonate a user
create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- test body: _test_as(<user>), then assertions

select * from finish();
rollback;
```

The `rollback` at the end means tests are non-destructive and can run in sequence.

Test user UUIDs are deterministic (from `supabase/seed.sql`):
- Platform admin: `00000000-0000-0000-0000-000000000001`
- Alpha admin:    `00000001-0000-0000-0000-000000001001`
- Alpha manager:  `00000001-0000-0000-0000-000000001002`
- Alpha staff:    `00000001-0000-0000-0000-000000001003`
- Alpha deact:    `00000001-0000-0000-0000-000000001004`
- Beta admin:     `00000002-0000-0000-0000-000000002001`
- Beta manager:   `00000002-0000-0000-0000-000000002002`
- Beta staff:     `00000002-0000-0000-0000-000000002003`

Facility UUIDs:
- Alpha: `00000001-0000-0000-0000-000000000001`
- Beta:  `00000002-0000-0000-0000-000000000002`
- Platform: via `platform_facility_id()` only (UUID generated at seed time)

---

## Gotchas

### 1. `facility_id` is immutable.
The trigger blocks all updates to `users.facility_id` coming from authenticated sessions. Moving a user between facilities requires direct service-role SQL plus an `audit_log` entry. Document in a future runbook.

### 2. Trigger-based checks beat RLS for some invariants.
RLS alone can't enforce "immutability" (it can only gate access, not block a specific column's change). For `users.facility_id` we use a trigger. Same for `user_roles` facility consistency. RLS is necessary but not sufficient.

### 3. `SECURITY DEFINER` functions read reference tables regardless of caller's RLS.
`current_facility_id()`, `is_platform_admin()`, `has_module_access()`, `platform_facility_id()` all query tables the caller might not be able to SELECT directly. This is intentional — policies depend on these lookups. Do not add RLS conditions to these functions; keep them mechanical.

### 4. `SET LOCAL` scope is per-transaction.
Impersonation's `app.impersonated_facility_id` is set per-transaction. Every server action that needs impersonation awareness must re-set the variable at the start of its DB work. Agent 7's platform-admin middleware handles this on every request.

### 5. `modules` is global.
Unlike every other table, `modules` is not tenant-scoped. Every facility sees the same catalog. Only platform admins write to it. Seeding happens in `20260419000005_modules.sql` and is idempotent.

### 6. `audit_log.facility_id` can be null.
For platform-only events (e.g., platform admin creates a new facility that didn't exist yet). All other audit rows must have facility_id set. Policies allow INSERT with null facility_id only for platform admins; regular users' audit writes are bound to their own facility.

### 7. RLS is enforced for `authenticated`, not `service_role`.
The Supabase service role bypasses RLS entirely. This is necessary for Agent 1b's accept-invite flow (which needs to create the `users` row before the user has ever logged in) and for Agent 7's webhook handlers. **Never expose the service role key to the client.**

### 8. Platform admins retain cross-facility SELECT even during impersonation.
Impersonation scopes `current_facility_id()` for write paths but every policy ORs in `is_platform_admin()`. This is deliberate — support engineers need to see the context around the facility they're helping, not just that one facility's rows. If you want hard-scope isolation, don't impersonate: log in as a facility admin directly.

### 9. Migrations must be idempotent.
We use `create table if not exists`, `drop policy if exists` before `create policy`, `on conflict do nothing` on seeds. This matters because greenfield environments get reset frequently and paste-into-SQL-editor is a supported workflow.

### 10. The Platform Operations facility exists in every environment.
Including dev, staging, prod. Migration `20260419000010_seed_platform_ops.sql` seeds it everywhere. Do not try to delete it — the partial unique index on `is_platform` and application assumptions (`platform_facility_id()` returning a real UUID) depend on its existence.

---

## Files shipped by Agent 1a

- `supabase/migrations/20260419000001_extensions.sql`
- `supabase/migrations/20260419000002_facilities.sql`
- `supabase/migrations/20260419000003_users.sql`
- `supabase/migrations/20260419000004_roles.sql`
- `supabase/migrations/20260419000005_modules.sql`
- `supabase/migrations/20260419000006_platform_admins.sql`
- `supabase/migrations/20260419000007_audit_log.sql`
- `supabase/migrations/20260419000008_helper_functions.sql`
- `supabase/migrations/20260419000009_rls_policies.sql`
- `supabase/migrations/20260419000010_seed_platform_ops.sql`
- `supabase/seed.sql` (dev/test only)
- `supabase/tests/01_helper_functions.test.sql`
- `supabase/tests/02_tenant_isolation.test.sql`
- `supabase/tests/03_platform_admin.test.sql`
- `supabase/tests/04_deactivated_users.test.sql`
- `supabase/tests/05_system_role_protection.test.sql`
- `middleware.ts` (Next.js)
- `lib/supabase/server.ts`, `lib/supabase/client.ts`
- `app/layout.tsx`, `app/page.tsx`, `app/login/page.tsx` (minimal scaffolding)
- `FOUNDATION.md` (this file)

## What's next

**Agent 1b** ships the invite flow, bootstrap action, and three new tables: `facility_invites`, `module_default_schemas`, `facility_resources`, plus the skeleton of `facility_subscriptions` for Agent 7 to build on. Read [`ONBOARDING.md`](./ONBOARDING.md) when that lands.
