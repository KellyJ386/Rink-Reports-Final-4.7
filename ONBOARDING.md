# ONBOARDING.md

User onboarding, invite flow, facility bootstrap, and the four new tables introduced by Agent 1b. Builds on Agent 1a's [`FOUNDATION.md`](./FOUNDATION.md).

**Read `FOUNDATION.md` first.** The tenancy model, RLS helpers, and platform-admin mechanics all come from there.

---

## New tables shipped here

| Table                      | Scope   | Purpose                                                                                |
| -------------------------- | ------- | -------------------------------------------------------------------------------------- |
| `facility_invites`         | Tenant  | Invite tokens (SHA-256-hashed). Lifecycle: created → accepted/revoked/expired.         |
| `module_default_schemas`   | Global  | Per-module default form_schemas. Agent 3/4 seed; `enableModule` copies per-facility.   |
| `facility_resources`       | Tenant  | Per-facility entities: surfaces, compressors, zambonis, devices, shift positions.      |
| `facility_subscriptions`   | Tenant  | Skeleton subscription state. Trialing row created at bootstrap. Agent 7 adds Stripe.   |

All four have RLS. `facility_invites`, `facility_resources`, `facility_subscriptions` are tenant-scoped via `facility_id`. `module_default_schemas` is global and read-only to facility admins.

## New SQL functions shipped here

| Function                                   | Caller          | Purpose                                                           |
| ------------------------------------------ | --------------- | ----------------------------------------------------------------- |
| `rpc_enable_module(facility_id, slug)`     | Facility admin  | Flip `facility_modules.is_enabled=true`; seed form_schemas.       |
| `rpc_create_facility_with_first_admin(…)`  | Platform admin  | Atomic: facility + subscription + Admin role + modules + invite.  |
| `rpc_lookup_invite_by_token(raw_token)`    | Unauthenticated | Return invite state: valid/expired/accepted/revoked/not_found.    |
| `rpc_complete_invite_acceptance(…)`        | Service role    | After Auth user created: insert users + user_roles + mark accept. |
| `rpc_revoke_invite(invite_id)`             | Facility admin  | Set `revoked_at`. Idempotent. Rejects if already accepted.        |

---

## Invite lifecycle

```
┌─────────┐   admin creates invite   ┌──────────┐
│ (none)  ├─────────────────────────►│ created  │
└─────────┘                          │ (token   │
                                     │  live)   │
                                     └────┬─────┘
                                          │
        ┌─────────────────────────────────┼─────────────────────────────────┐
        │                                 │                                 │
        ▼                                 ▼                                 ▼
   ┌─────────┐                       ┌─────────┐                       ┌─────────┐
   │ accepted│                       │ revoked │                       │ expired │
   │(user in)│                       │ (admin) │                       │(>7days) │
   └─────────┘                       └─────────┘                       └─────────┘
```

- **One-shot:** after `accepted_at` is set, the token is dead. Re-clicks return `'accepted'`.
- **Hash-stored:** `token_hash = sha256(raw_token)`. Raw token lives only in the recipient's inbox.
- **Partial unique index** on `(facility_id, lower(email)) where accepted_at is null and revoked_at is null` — prevents issuing two outstanding invites to the same email.

## Accept-invite flow

The `/accept-invite` endpoint is the one place in the product where an unauthenticated user interacts with facility data. Treated as hostile input.

```
 User clicks email link with ?token=XYZ
           │
           ▼
 ┌───────────────────────────────────────────────┐
 │ 1. Rate limit by IP (5/15min)                 │ ← fail: 429 / "too many attempts"
 └───────────────────────────────────────────────┘
           │
           ▼
 ┌───────────────────────────────────────────────┐
 │ 2. rpc_lookup_invite_by_token(raw_token)      │
 │    (SHA-256 hash + indexed lookup)            │ ← state in {valid, expired,
 └───────────────────────────────────────────────┘     accepted, revoked, not_found}
           │
           ▼
 ┌───────────────────────────────────────────────┐
 │ 3. Render form with facility_name + role_name │
 │    for 'valid'; render explanatory page       │
 │    for other states                           │
 └───────────────────────────────────────────────┘
           │ user submits form (full name + password)
           ▼
 ┌───────────────────────────────────────────────┐
 │ 4. Revalidate state (TOCTOU)                  │
 │    Reject if state != 'valid' now             │
 └───────────────────────────────────────────────┘
           │
           ▼
 ┌───────────────────────────────────────────────┐
 │ 5. supabase.auth.admin.createUser(            │
 │      email: invite.email,                     │ ← service role required
 │      password,                                │
 │      email_confirm: true                      │
 │    )                                          │
 └───────────────────────────────────────────────┘
           │
           ▼
 ┌───────────────────────────────────────────────┐
 │ 6. rpc_complete_invite_acceptance(            │
 │      invite_id, auth_user_id, full_name       │ ← atomic SQL:
 │    )                                          │    insert users
 │                                               │    insert user_roles
 │                                               │    update invite.accepted_at
 │                                               │    insert audit_log
 └───────────────────────────────────────────────┘
           │
           ▼
 ┌───────────────────────────────────────────────┐
 │ 7. signInWithPassword → set session cookie    │
 │    Redirect → /                               │
 └───────────────────────────────────────────────┘
```

### Security checklist

| Concern                         | Mitigation                                                                 |
| ------------------------------- | -------------------------------------------------------------------------- |
| Token guessing                  | 32-byte random token (256 bits); SHA-256 storage; rate-limited lookup      |
| Timing oracle                   | Single constant-time indexed query; generic `not_found` for short inputs   |
| Replay after acceptance         | `accepted_at` check + row-lock in `rpc_complete_invite_acceptance`          |
| Replay after revocation         | `revoked_at` check                                                         |
| Replay after expiry             | `expires_at <= now()` check                                                |
| Forged email at acceptance      | Auth user is created with the invite's email, not the form's email         |
| Orphaned auth.users on DB error | TS layer calls `supabase.auth.admin.deleteUser(id)` on RPC failure         |
| Weak passwords                  | 12-char minimum enforced client + server                                   |

## Bootstrap flow (platform admin creates a new facility)

```
 Platform admin → /platform-admin/facilities/new (Agent 7's UI)
           │
           ▼
 TS:  const { facility_id, invite_url } = await createFacilityWithFirstAdmin({
         name, address, firstAdminEmail   // timezone auto-derived from postal_code
       })
           │
           ▼
 SQL: rpc_create_facility_with_first_admin(...)
           │
           ▼
 ┌─────────────────────────────────────────────────────┐
 │ Single DB transaction (SECURITY DEFINER as platform│
 │ admin; AuthZ check inside):                         │
 │                                                     │
 │  1. insert facilities (slug, plan_tier='trial',     │
 │     is_platform=false)                              │
 │  2. insert facility_subscriptions                   │
 │       (status='trialing', trial_end=now+30d)        │
 │  3. insert roles (facility_id, 'Admin',             │
 │       is_system=true)                               │
 │  4. for each module:                                │
 │       rpc_enable_module(facility_id, slug)          │
 │         ├─ flip facility_modules.is_enabled=true    │
 │         ├─ (future) seed form_schemas from defaults │
 │         └─ audit: module.enabled                    │
 │       insert role_module_access                     │
 │         (Admin role, module, 'admin')               │
 │  5. generate random 32-byte token                   │
 │     token_hash = sha256(raw)                        │
 │     insert facility_invites                         │
 │       (facility_id, firstAdminEmail, Admin role,    │
 │        token_hash, expires_at=now+7d)               │
 │  6. audit: facility.created                         │
 │                                                     │
 │  RETURN (facility_id, raw_token)                    │
 └─────────────────────────────────────────────────────┘
           │
           ▼
 TS: invite_url = `${NEXT_PUBLIC_APP_URL}/accept-invite?token=${raw_token}`
           │
           ▼
 ════════════ SEAM ══════════════
 Before this call: facility doesn't exist.
 After:            facility admin accepts invite, takes over.
           │
           ▼
 Platform admin delivers invite_url to firstAdminEmail (email, Slack, etc.)
           │
           ▼
 Facility admin clicks → accept-invite flow above → dashboard
           │
           ▼
 Facility admin invites staff via Agent 6's /admin/invites UI
```

### The platform-admin / facility-admin seam

Everything before `rpc_create_facility_with_first_admin` runs under platform admin authority. Everything after the facility admin accepts the invite runs under that admin's authority. Nothing bridges them except the invite token and the `audit_log` trail.

## How Agent 6 uses these server actions

Agent 6's admin UI surfaces these server actions:

| Agent 6 route                       | Server action                              | Module                    |
| ----------------------------------- | ------------------------------------------ | ------------------------- |
| `/admin/invites` (list + new)       | `createInvite({ email, roleId })`          | `lib/invites/create.ts`   |
| `/admin/invites` (revoke button)    | `revokeInvite(inviteId)`                   | `lib/invites/revoke.ts`   |
| `/admin/modules` (enable toggle)    | `enableModule(facilityId, moduleSlug)`     | `lib/facility/enable-module.ts` |
| `/platform-admin/facilities/new`    | `createFacilityWithFirstAdmin({ … })`      | `lib/facility/create.ts`  |

Agent 6 does **not** re-implement token generation, state machines, or validation. It calls these actions and renders results.

## Default module bundle

`createFacilityWithFirstAdmin` enables **every module in the `modules` catalog** for a new facility. Rationale: facility admins disable what they don't use via `/admin/modules`. It's easier to turn off than to turn on retroactively.

When plan tiers start gating modules (multi_facility, enterprise), this default bundle will be filtered by tier. Not in v1.

## Platform admin bootstrap

There's a chicken-and-egg: `rpc_create_facility_with_first_admin` requires `is_platform_admin()` to be true, but the first platform admin has to be created somehow.

### Dev

`supabase/seed.sql` seeds platform admin `00000000-0000-0000-0000-000000000001` alongside the Platform Operations facility. `supabase db reset` runs seeds automatically.

### Production runbook

Run **once**, as the service role (via `psql`, Supabase SQL Editor while authenticated as project owner, or `supabase db execute`):

```sql
-- 1. Create auth.users for the first platform admin
--    (or let them sign up with email/password through Supabase Auth first, then note their user_id)
-- 2. Insert their profile row pinned to the Platform Operations facility
insert into public.users (id, facility_id, full_name, email, active)
values (
  '<auth_user_id>',
  public.platform_facility_id(),
  'First Platform Admin',
  '<email>',
  true
);

-- 3. Grant platform admin
insert into public.platform_admins (user_id)
values ('<auth_user_id>');
```

After step 3, that user can log in, navigate to `/platform-admin/facilities/new`, and create real facilities via the UI.

## Timezone derivation

`createFacilityWithFirstAdmin` accepts an optional `timezone` parameter. If omitted, it's derived from `address.postal_code` using `lib/timezone/from-postal-code.ts` — a static JSON lookup shipped in-repo (`lib/timezone/postal-code-zones.json`).

Coverage:
- **US:** 5-digit ZIP → IANA timezone via range table. All 50 states + DC + territories.
- **Canada:** first letter of FSA (A–Y) → IANA timezone.

Failures (malformed postal codes, non-NA codes) return `null`, and the bootstrap falls back to `'UTC'`. Facility admins can override via Agent 6's admin UI later.

Why static: zero runtime dependencies, works offline, and the 2,500-facility target is entirely North American. A dynamic lookup (Google Maps Time Zone API) adds an env var and latency for no functional benefit.

## Rate limiting

`lib/invites/rate-limit.ts` implements an in-memory token bucket keyed by IP.

| Bucket name       | Capacity | Refill        |
| ----------------- | -------- | ------------- |
| `accept-invite`   | 5        | 5 / 15 min    |
| `invite-create`   | 20       | 20 / 60 min   |

**Known v1 limitation:** state lives in the Node.js process. Cold starts on Vercel reset the counter. Horizontal scaling multiplies the effective limit. Agent 7 replaces this with Upstash Ratelimit when traffic patterns justify it; the interface (`consume(name, identifier): boolean`) stays the same.

## Email delivery

Phase 1 uses **Supabase's built-in SMTP**. Invite URLs are returned to the admin from `createFacilityWithFirstAdmin` / `createInvite`; delivery happens either:
- By the admin copying the URL and pasting into email/Slack manually (v1 default)
- Via a future Resend integration (Agent 7)

The RPC does not send email directly. Keeping delivery in the TS layer means Agent 7 swaps providers without touching SQL.

## Known gotchas

1. **`module_default_schemas` is empty in Phase 1.** Agent 3 (form-engine modules) and Agent 4 (Ice Depth template defaults, if applicable) seed rows here when their modules land. Until then, `enableModule` runs but no form_schemas get seeded. `audit_log.metadata.seeded_defaults` is `false` in Phase 1.

2. **`form_schemas` doesn't exist yet in Phase 1.** `rpc_enable_module` guards the insert via `information_schema.tables` + dynamic SQL. When Agent 2 ships `form_schemas`, the guard flips true and seeding begins — no function change needed.

3. **`facility_subscriptions` has no gating middleware yet.** Writes are unrestricted for all facilities regardless of `status`. Agent 7 adds `requireActiveSubscription` middleware. Until then, trial facilities behave identically to paid.

4. **`rpc_complete_invite_acceptance` runs as service role.** The auth user doesn't exist in `public.users` at the moment this runs — the whole point is to atomically create the profile row + assign the role. A facility admin cannot call this directly; only the accept-invite server action has the service-role client.

5. **Failed acceptance cleanup is best-effort.** If `rpc_complete_invite_acceptance` fails after `auth.admin.createUser` succeeds, the TS layer calls `auth.admin.deleteUser` to avoid orphans. If the cleanup ALSO fails, the invite stays consumable but there's a stranded auth row. Rare; flagged for manual platform-admin cleanup via a future health check.

6. **Invite email is checked against `invite.email` at Auth creation, not at form submit.** The accept-invite form shows the email as readonly. A user who forges the form value won't succeed because `auth.admin.createUser` uses the invite's email, not the form's.

7. **Rate limiter resets on deploy.** After a Vercel deploy, all rate-limit counters start fresh. An attacker timing a token-guessing campaign across deploys could theoretically get extra attempts. Acceptable for v1; Upstash fixes it.

---

## Files shipped by Agent 1b

**Migrations:**
- `supabase/migrations/20260420000001_module_default_schemas.sql`
- `supabase/migrations/20260420000002_facility_resources.sql`
- `supabase/migrations/20260420000003_facility_subscriptions.sql`
- `supabase/migrations/20260420000004_facility_invites.sql`
- `supabase/migrations/20260420000005_enable_module_fn.sql`
- `supabase/migrations/20260420000006_create_facility_fn.sql`
- `supabase/migrations/20260420000007_accept_invite_fn.sql`

**TypeScript:**
- `lib/supabase/service.ts`
- `lib/timezone/from-postal-code.ts` + `postal-code-zones.json`
- `lib/invites/rate-limit.ts`
- `lib/invites/create.ts`
- `lib/invites/revoke.ts`
- `lib/invites/accept.ts`
- `lib/facility/create.ts`
- `lib/facility/enable-module.ts`
- `app/accept-invite/page.tsx` + `form.tsx` + `actions.ts`

**Tests (pgTAP):**
- `supabase/tests/06_facility_resources.test.sql`
- `supabase/tests/07_facility_invites.test.sql`
- `supabase/tests/08_enable_module.test.sql`
- `supabase/tests/09_bootstrap.test.sql`
- `supabase/tests/10_facility_subscriptions.test.sql`

**Updated:**
- `supabase/seed.sql` — adds subscription rows + example `facility_resources`
- `.env.example` — adds `NEXT_PUBLIC_APP_URL`
- `ONBOARDING.md` (this file)

## What's next

**Agent 2** builds the form engine and stamps Circle Check at `/modules/ice-maintenance/circle-check`. The `module_default_schemas` table is the seam: Agent 2 seeds a default Circle Check schema there, and future facility creations automatically get it via `enableModule`. See `FORM_SCHEMA_FORMAT.md` and `FORM_ENGINE.md` when Agent 2 lands.
