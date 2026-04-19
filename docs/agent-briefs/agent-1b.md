# Agent 1b — Onboarding Architect

## Your role
You are the Onboarding Architect. Agent 1a has already shipped: schema, RLS, `current_facility_id()` (with impersonation awareness), `is_platform_admin()`, `has_module_access()`, platform admin escape hatch, audit log, deactivated-user auth middleware, and passing tenant-isolation tests. Your job is the invite and bootstrap flow — plus the per-facility infrastructure that downstream modules depend on: default schemas, shared resources, and the skeleton for subscription state.

You do not modify Agent 1a's tables except to add FKs where necessary. You do not build admin UI — Agent 6 does. You build the backend that Agent 6 will call.

## Product context (brief — Agent 1a's `FOUNDATION.md` has the full version)
Ice rink SaaS. Each user belongs to exactly one facility. All new users created via admin invite — no self-signup anywhere. A "facility admin" is a user with admin access on the Admin Control Center module. Platform admins create facilities and the first facility admin, and set each facility's subscription state on creation.

## Design decisions already made
- No self-signup, ever
- Invite tokens are one-shot, time-limited, stored as hashes
- Email in the invite must match the email Supabase Auth receives at acceptance
- Facility move requires direct DB work + audit log, not self-serve
- Modules each have a global default form schema; facilities receive a per-facility copy when the module is enabled, via `module_default_schemas` → `form_schemas` seeding
- Per-facility entities (surfaces, compressors, zambonis, air quality devices, shift positions) all live in one table — `facility_resources` — keyed by `resource_type`
- Every facility starts in a 30-day trial. The `facility_subscriptions` row is created at facility creation with `status = 'trialing'`. Agent 7 adds Stripe integration on top of this skeleton.

## Stack (same as 1a)
Next.js 15 App Router, Supabase, TS strict, Drizzle-or-Supabase-types (match 1a's choice), pgTAP/supabase-js tests.

## Deliverables

### 1. `facility_invites` schema
Columns: id, facility_id (fk), email (citext), role_id (fk), invited_by (user_id fk), token_hash, expires_at, accepted_at (nullable), revoked_at (nullable), created_at.

Store the SHA-256 hash, not the raw token. The raw token is returned once at invite creation and delivered via email link; never stored. Justify the choice in your first response.

Indexes: unique on token_hash; partial index on `(facility_id, lower(email))` where `accepted_at IS NULL AND revoked_at IS NULL` for "already invited?" lookups.

### 2. `module_default_schemas` schema
Global table (not tenant-scoped — modules are global; defaults ship with the code).

Columns:
- `module_slug text not null`
- `form_type text` (nullable; null for modules with a single form)
- `default_schema_definition jsonb not null`
- `updated_at timestamptz default now()`
- Primary key: `(module_slug, coalesce(form_type, ''))`

Seed rows are written by Agent 3 when each module lands. You ship the empty table + schema + the migrations that let Agent 3 insert into it.

### 3. `facility_resources` schema
Per-facility entities referenced by form schemas and modules.

Columns:
- `id uuid pk`
- `facility_id uuid not null default current_facility_id()`
- `resource_type text not null` — values like `'surface'`, `'compressor'`, `'zamboni'`, `'air_quality_device'`, `'shift_position'` (extensible; no check constraint that enumerates them — that's a code-level convention)
- `name text not null`
- `sort_order int not null default 0`
- `is_active bool not null default true`
- `created_at timestamptz default now()`

Index on `(facility_id, resource_type, is_active, sort_order)`. RLS: facility isolation; INSERT/UPDATE/DELETE gated by `has_module_access('admin_control_center', 'admin')` (admins manage resources).

### 4. `facility_subscriptions` schema (skeleton for Agent 7)
You ship the full table so `createFacilityWithFirstAdmin` can insert the trialing row. Agent 7 wires Stripe webhooks and gating middleware later — the schema is complete now.

Columns:
- `facility_id uuid pk references facilities`
- `stripe_customer_id text nullable`
- `stripe_subscription_id text nullable`
- `status text not null` — `'trialing' | 'active' | 'past_due' | 'canceled'`
- `plan_tier text nullable`
- `trial_end timestamptz nullable`
- `current_period_end timestamptz nullable`
- `created_at`, `updated_at`

RLS: SELECT for facility admins (own facility) + platform admins; INSERT/UPDATE for service role only (Agent 7's webhook handler). In v1 before Agent 7, your bootstrap action writes directly.

### 5. RLS on `facility_invites`
- SELECT: facility admins for own facility; platform admins all
- INSERT: facility admins for own facility only; `facility_id` forced via `current_facility_id()`, never accepted from client
- UPDATE: only the accept-invite server action may set `accepted_at`; only admins may set `revoked_at`; no other updates
- DELETE: not permitted (revoke via `revoked_at`, don't delete audit trail)

A facility admin must not be able to issue an invite with a forged `facility_id`. Explicitly tested.

### 6. `enableModule` server action
Signature: `enableModule(facility_id: uuid, module_slug: text)`.

Behavior:
1. Verifies caller is a platform admin OR a facility admin acting on their own facility.
2. Flips `facility_modules.is_enabled = true` for that module (upserting if needed).
3. For each `module_default_schemas` row matching this `module_slug`, inserts a `form_schemas` row for this facility with `schema_definition = default_schema_definition`, `version = 1`, `is_published = true`. The `form_schemas` table itself is owned by Agent 2; you insert into it by contract.
4. Writes `audit_log` entry.

If no `module_default_schemas` rows exist for a module (e.g., Ice Depth, Scheduling, Communications — modules that don't use the form engine), the action still runs; it simply seeds zero `form_schemas` rows.

### 7. Accept-invite server action
Route: `/accept-invite?token=...`. Unauthenticated endpoint — treat as hostile input.

Validation order:
1. Rate-limit by IP
2. Hash incoming token, look up by `token_hash` (constant-time lookup via index)
3. Reject if not found, expired, already accepted, or revoked
4. Validate email match against what Supabase Auth will receive
5. Create `auth.users` row (Supabase), then `users` profile row with `facility_id` from invite and `active = true`, then `user_roles` from invite
6. Set `accepted_at`
7. Write audit_log entry
8. One-shot: token is dead after acceptance

All of this in a single transaction. If any step fails, no user is created, no invite is marked accepted.

### 8. Bootstrap flow
Platform-admin-only server action: `createFacilityWithFirstAdmin({ name, timezone, address, firstAdminEmail })`:
1. Creates `facilities` row with default `settings = '{}'::jsonb`.
2. Creates `facility_subscriptions` row with `status = 'trialing'`, `trial_end = now() + interval '30 days'`.
3. Seeds the facility's system "Admin" role with `is_system = true`.
4. Calls `enableModule(facility_id, slug)` for every module in the default bundle. Document the default bundle explicitly (recommendation: all 8 operational modules + Admin Control Center enabled at creation; facility admin disables any they don't use).
5. Assigns the Admin role full `role_module_access.access_level = 'admin'` on every enabled module.
6. Issues an invite for `firstAdminEmail` with the Admin role.
7. Returns the invite URL (raw token) for the platform admin to deliver.
8. Writes `audit_log`.

Document in `ONBOARDING.md` where the seam is: before this call, a facility doesn't exist. After it, a facility admin can accept the invite and take over staff invites themselves.

### 9. Rate limiting
Simple token bucket keyed by IP on `/accept-invite`. If no shared rate-limit utility exists project-wide, pick the simplest viable option (Upstash Redis or in-memory per-process) and document the production gap.

### 10. Integration tests — the hard gate
- Facility admin can invite a staff user; invite appears in own facility's list and nowhere else
- Accepting an invite creates a user pinned to the correct facility with the correct role and writes audit_log
- Accepted user has `active = true` and can authenticate
- Expired token rejected
- Already-accepted token rejected
- Revoked token rejected
- Email mismatch rejected
- Facility admin cannot issue an invite with a forged `facility_id` (payload override)
- Non-admin user cannot issue invites
- Platform admin can run the bootstrap flow: facility + subscriptions + modules + default schemas + admin role + invite all land atomically; resulting facility admin accepts and invites staff
- `facility_subscriptions.status = 'trialing'` after bootstrap
- `enableModule` seeds default schemas for a module with `module_default_schemas` rows; is a no-op for one without
- Rate limiter rejects N+1 attempts from same IP within window

### 11. Migrations
Additive only. Do not alter Agent 1a's tables beyond FK references or helpful indexes (justify each). Idempotent. Each has a down migration.

### 12. Documentation
`ONBOARDING.md` in repo root:
- Invite lifecycle
- Bootstrap flow with the platform-admin / facility-admin seam called out
- The default module bundle enabled at creation
- Accept-invite security checklist
- How Agent 6 should call `enableModule`, the invite actions, and the bootstrap flow
- Catalog of new tables shipped here (`facility_invites`, `module_default_schemas`, `facility_resources`, `facility_subscriptions`) and what later agents add to each

## Definition of done — hard gate
- All Deliverable 10 tests pass
- `ONBOARDING.md` exists and Agent 6 could build the admin UI against it without guessing
- Agent 1a's isolation test suite still passes (no regressions)
- Platform admin can create a facility with one call; everything downstream is ready for a facility admin to take over
- Facility admin can invite staff; invites appear only in their facility
- `enableModule` correctly seeds or no-ops depending on whether the module has defaults

## What you do NOT build
- Admin UI for managing invites or resources — Agent 6
- Email templates beyond Supabase defaults
- Password reset, MFA, session management beyond what Supabase gives you
- Stripe webhooks or gating middleware — Agent 7 (the skeleton `facility_subscriptions` is yours; Stripe is theirs)
- Any module or form business logic
- Changes to Agent 1a's tables beyond adding FKs/indexes with justification
- The `form_schemas` table (Agent 2 owns it; `enableModule` inserts rows into it by contract)

## Constraints
Browser-only workflow. Inline SQL and file contents. No photo storage. No AI/LLM features. Clean build.

## First response
Do NOT write code yet. Deliver:
1. Schema diagram showing `facility_invites`, `module_default_schemas`, `facility_resources`, `facility_subscriptions`, and their FKs to Agent 1a's tables
2. Accept-invite flow diagram with every security check called out at the step it happens
3. Bootstrap flow diagram, with the platform-admin / facility-admin seam labeled and the enableModule-seeding path shown
4. Token storage decision (hash) justified
5. Rate limiter decision with justification
6. Default module bundle proposal
7. `enableModule` pseudocode (the seeding logic against `module_default_schemas`)
8. Open questions before migrations
9. Proposed migration order

Wait for approval before writing SQL.
