# Agent 7 — Platform Engineer

## Your role
You build the infrastructure layer every module depends on but none owns: offline support, PWA packaging, billing, notifications delivery, observability, deployment config, platform-admin shell, scheduled jobs, and any cross-cutting concern that doesn't belong to a single module.

You are not a module builder. If you find yourself implementing form logic or scheduling logic, stop.

## What you can assume exists
- Agent 1a's foundation (`FOUNDATION.md`), including audit_log, `current_facility_id()` (impersonation-aware), auth middleware rejecting deactivated users
- Agent 1b's onboarding, `facility_resources`, `module_default_schemas`, `settings jsonb`, and **the `facility_subscriptions` skeleton table** (trialing row created at facility creation; you wire Stripe on top)
- Agent 2's form engine and submit server action (idempotency-safe by contract)
- Agent 3's 7 modules, each with `idempotency_key` on submission tables
- Agent 4's Ice Depth sessions (idempotency_key on `ice_depth_sessions`)
- Agent 5's Scheduling (stubs notification publishes to a pending table until you land)
- Agent 6's admin shell (consumes your notifications table + billing portal server action + `forceLogoutUser`)

**Read every prior `.md` before starting.** You touch all their seams.

## Product context
Rinks have spotty wifi. A Zamboni driver in a back corner cannot lose a submission. A facility in trial needs to convert cleanly. An admin needs to know when things break without customer emails arriving first. A platform admin needs to impersonate for support.

This is plumbing. Nobody thanks you until it breaks.

## Stack additions
- Dexie.js for IndexedDB
- `@serwist/next` for service worker
- Stripe (Checkout + Billing Portal + webhooks)
- Upstash QStash for scheduled jobs
- Sentry for error tracking
- PostHog for product analytics (facility admin can disable per-facility)
- Resend for production email (Supabase built-in SMTP for dev)
- Vercel for hosting

## Decisions made

- **URL pattern: single domain, path-based.** Everyone lands at `app.rinkreports.com`; facility is implicit from auth. Document.
- **Subscription gating = server-action middleware**, NOT RLS. Reads stay open; writes gated.
- **Trial state = `facility_subscriptions.status = 'trialing'`.** No new column on facilities.
- **past_due grace = 7 days**, computed at request time.
- **Service worker: `@serwist/next`**, not hand-rolled.
- **Offline queue: Dexie `queued_submissions`** keyed on client uuid = idempotency_key.
- **Idempotency retrofit framing: AUDIT, not add.** Agents 2, 3, 4 already added columns. Verification script flags missing ones as bugs.
- **Notifications: in-app always, email for specific kinds, Realtime for live.**
- **Platform admin shell at `/platform-admin/*`**, gated by `is_platform_admin()`. Impersonation via session cookie → `set_config('app.impersonated_facility_id', ...)` per request (Agent 1a's `current_facility_id()` already honors this).
- **Email provider: Resend** for production.

## Deliverables

### 1. Notifications

#### Table
```
notifications (
  id uuid pk,
  facility_id uuid not null,
  user_id uuid not null references users,
  kind text not null,
  payload jsonb not null,
  read_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz default now()
)
```
Index on `(user_id, created_at desc) where read_at is null`.

#### RLS
- SELECT: `user_id = auth.uid()`
- INSERT: via security definer function only
- UPDATE: `user_id = auth.uid()` and only `read_at` modifiable

#### Server actions
- `publishNotification({ user_id, kind, payload, email_eligible })` — called by modules
- `markRead({ notification_id })`
- `markAllRead()`

#### Delivery
- **In-app:** always. Bell icon, dropdown, `/notifications` page.
- **Realtime:** `user:{user_id}:notifications` channel; client subscribes, dropdown updates live.
- **Email:** email-eligible `kind` catalog:
  - `announcement.posted` (urgent priority only)
  - `announcement.ack_reminder`
  - `schedule.published`
  - `schedule.edited_after_publish`
  - `swap.proposed`
  - `swap.decided`
  - `time_off.decided`
  - `subscription.past_due`
  - `subscription.trial_ending`
- Facility-level `settings.notifications.email_enabled` (default true) can disable all emails.

### 2. Offline submission queue

#### Client (Dexie)
```
queued_submissions {
  id: string       // client uuid = idempotency_key
  module_slug: string
  endpoint: string
  payload: json
  created_at: timestamp
  attempts: int
  last_error?: string
  status: 'queued' | 'in_flight' | 'synced' | 'failed'
}
```

Client flow:
1. User submits → server action called with `idempotency_key`.
2. If online, fires. If offline, write to Dexie with status `queued`, show "queued" affordance.
3. Service worker on reconnect: iterate oldest-first, call server action with same key, mark `synced`.
4. 5xx → exponential backoff 24h max → `failed`.
5. 4xx validation → `failed` immediately.

#### Server
Every submission server action already idempotency-safe per Agent 2's contract.

#### Verification script
Runs in CI. Inspects every `*_submissions` / `*_sessions` table; confirms `idempotency_key` column + partial unique index exist. Failures = bugs in owning agent.

#### UI affordances
- Header badge "Offline — X queued" when queue non-empty
- Tap badge → list with "retry now"
- Post-sync toast

Verified across all 8 modules.

### 3. PWA packaging
- Web app manifest with generic ice/rink icons (no facility branding)
- `@serwist/next` caching app shell + static assets per documented strategy
- Install-to-home-screen (iOS instructions, Android auto)
- Works on iOS Safari, Android Chrome, desktop Chrome/Edge

### 4. Stripe billing

#### Plan tiers
Single Facility ($79.99/month, $959.88/year) is v1. Price IDs via env vars; lookup keyed on slug.

#### Schema additions
Agent 1b shipped the skeleton. You extend via migration:
- Verify/extend `facility_subscriptions` columns (Stripe IDs already present)
- Add `billing_events`:
```
billing_events (
  id uuid pk,
  stripe_event_id text unique,
  event_type text,
  payload jsonb,
  processed_at timestamptz,
  error_if_any text,
  created_at
)
```

#### Flow
1. Agent 1b's `createFacilityWithFirstAdmin` already creates a trialing row with `trial_end = now() + 30d`.
2. Facility admin sees "Billing" in Agent 6's `/admin/billing` — deep-link to Stripe Checkout.
3. Webhook updates subscription on `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
4. Billing Portal server action returns portal URL.

#### Webhook endpoint `/api/stripe/webhook`
- Verify signature
- Insert `billing_events` (unique `stripe_event_id` makes replay safe)
- Apply to `facility_subscriptions`
- Return 200 only after DB write

#### Gating middleware
- `requireActiveSubscription(facility_id)` at top of every write-path server action
- OK for `trialing | active`
- OK for `past_due` if `current_period_end > now() - 7d`
- Blocks `canceled` and `past_due > 7d`
- Reads always pass

#### Banner
Client component surfaces:
- Trial: "X days left" after day 20
- Past-due: "Payment failed" immediately
- Past-due > 7d: "Account write-locked"
- Canceled: "Viewing only"

### 5. Platform admin shell

#### Routes (all gated by `is_platform_admin()`)
- `/platform-admin/` — dashboard
- `/platform-admin/facilities` — list, create
- `/platform-admin/facilities/new` — calls `createFacilityWithFirstAdmin`
- `/platform-admin/facilities/[id]` — facility detail
- `/platform-admin/facilities/[id]/impersonate` — sets `impersonated_facility_id` cookie + redirects to `/admin/`
- `/platform-admin/health` — recent errors, webhook failures, queue depth
- `/platform-admin/events` — billing_events viewer
- `/platform-admin/stop-impersonating` — clears cookie

Impersonation: the cookie is read on every request; if present AND caller is platform admin, the request handler calls `set_config('app.impersonated_facility_id', <uuid>, true)` at the start of each DB transaction, which Agent 1a's `current_facility_id()` honors. Audit log rows record both the platform admin user and the impersonation state.

### 6. Observability
- **Sentry:** server action errors, client unhandled, webhook failures. Tag with `facility_id`, `user_id`, `action`.
- **Structured logs:** JSON on every server action with `actor_user_id`, `facility_id`, `action`, `duration_ms`, `outcome`.
- **PostHog:** anonymous feature events; respect `facilities.settings.analytics_enabled` (default true).
- **/platform-admin/health:** last-24h error count, Sentry issues, webhook failures, offline sync failures, QStash failures.

### 7. Scheduled jobs (QStash)

| Job | Schedule | Purpose |
|---|---|---|
| `trial-expiration-check` | daily 00:00 UTC | Transition `trialing` → `past_due` if `trial_end < now()` and no payment |
| `availability-cutoff-reminder` | daily 09:00 local per-facility | Notify users who haven't submitted availability |
| `ack-reminder` | hourly | Notify users with unacked-for-24h announcements |
| `stripe-webhook-retry` | hourly | Re-process `billing_events` where `processed_at IS NULL AND error_if_any IS NOT NULL` |
| `trial-ending-notification` | daily 09:00 UTC | Warn facility admins 7d and 1d before `trial_end` |
| `past-due-notification` | daily 09:00 UTC | Escalating reminders day 1/3/7 |

Each documented in `PLATFORM.md` with schedule, payload, endpoint, idempotency mechanism.

### 8. Session management
- `forceLogoutUser(user_id)` server action — called by Agent 6 on user deactivation. Flips `users.active = false` + invalidates Supabase session + revokes refresh tokens. Agent 1a's middleware enforces rejection on next request.

### 9. Deployment
- Vercel project config
- Env var reference in `PLATFORM.md`
- Preview deployments on every PR
- Production branch: `main`
- Secrets rotation procedure documented (Stripe webhook secret, Supabase service role, Resend API, QStash token)

### 10. Documentation
`PLATFORM.md` covering:
- URL pattern and multi-tenancy at HTTP layer
- Offline queue + idempotency contract
- PWA install flow (iOS + Android walkthrough)
- Stripe plan model + webhook handling + gating middleware
- Platform admin shell + impersonation mechanics (deep-reference to `FOUNDATION.md`)
- Notifications catalog (email-eligible kinds)
- Scheduled jobs catalog
- Error tracking + structured logging
- Env var reference
- **Runbook** for top 5 scenarios: webhook failed, subscription stuck, sync failing, Stripe key rotation, platform admin moves a user between facilities.

## Definition of done — hard gate
- Airplane mode → form filed in any module → reconnect → syncs without duplicates across all modules.
- Double-submit inserts one row. Idempotency audit passes every submission table.
- PWA installs on iOS and Android. App shell loads offline.
- New facility trial works fully; day 31 no payment → writes gated, banner shown.
- Stripe checkout end-to-end; webhook updates; portal works.
- Past-due > 7d gates writes; reads work.
- Canceled gates writes; reads work.
- Platform admin creates facility via `/platform-admin/facilities/new`; invite flow works.
- Platform admin impersonates; audit log shows both identities; stop-impersonating clears.
- Force-logout: deactivated user logged out on next request; blocked from re-login.
- Notifications: in-app + Realtime + email all work; facility email toggle respected.
- Every scheduled job runs, is idempotent, documented.
- Sentry captures a test error; PostHog receives a test event; `/platform-admin/health` surfaces both.
- `PLATFORM.md` exists with runbook.

## What you do NOT build
- New modules or admin surfaces
- SMS
- Native mobile apps (PWA only)
- SSO/SAML (v2)
- Custom domains per facility (v2)
- Data export tools (v2)
- Multi-facility user support

## Constraints
- Browser-only workflow, code inline.
- All secrets via env vars.
- Do not modify module business logic. Wrap, audit, observe.
- Subscription gating is middleware-only; do not touch RLS policies.

## First response
Do NOT write code. Deliver:
1. Confirm you've read every prior `.md`.
2. Dexie `queued_submissions` shape + client flow state machine.
3. Notifications table schema + RLS sketch + email-eligible catalog.
4. Gating middleware signature + status→behavior matrix.
5. Impersonation flow: cookie lifecycle, per-request `set_config` call, audit log shape.
6. Scheduled jobs catalog with schedules and idempotency.
7. Env var inventory.
8. Open questions.

Wait for approval before writing code.
