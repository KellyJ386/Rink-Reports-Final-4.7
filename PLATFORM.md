# PLATFORM.md

Cross-cutting infrastructure shipped by Agent 7. Every prior agent builds modules on top of these primitives; every future agent can assume they exist.

Read `FOUNDATION.md`, `ONBOARDING.md`, `FORM_ENGINE.md`, `ADMIN.md`, and `ICE_DEPTH.md` before this file — they describe the things Agent 7 wraps, gates, and instruments.

---

## Scope

Agent 7 owns:

1. **Subscription billing** — Stripe Checkout + Billing Portal + webhooks; `requireActiveSubscription` middleware; past-due grace window; trial countdown
2. **Notifications** — single `notifications` table; `publishNotification()` server-side API; email delivery via Resend with a per-kind catalog; Supabase Realtime for live updates
3. **Offline submission queue** — Dexie IndexedDB on the client; sync loop; `/api/offline-submit` bridge
4. **PWA packaging** — manifest, service worker via `@serwist/next`
5. **Platform admin shell** — `/platform-admin/*` (facilities, health, billing events); impersonation session cookies + `rpc_set_request_vars` + audit_log auto-tagging
6. **Scheduled jobs** — six QStash-driven route handlers
7. **Observability** — structured logger, Sentry wrapper, PostHog (all graceful-degrading when env vars absent)
8. **Finalized `forceLogoutUser`** — replacing Agent 6's inline implementation

## URL pattern

Single domain, path-based. Every user lands at `https://app.rinkreports.com` (or the URL in `NEXT_PUBLIC_APP_URL`) and their facility is implicit from auth. No per-facility subdomains; no custom domains in v1.

## Env vars reference

| Var | Required? | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Yes (Agent 1a) | Supabase |
| `NEXT_PUBLIC_APP_URL` | Yes | Base URL used in emails, invite links, checkout return URL |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | For billing | Stripe server-side |
| `STRIPE_PRICE_ID_SINGLE_FACILITY_MONTHLY`, `..._ANNUAL` | For billing | Checkout prices |
| `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` | For email | Transactional email. Missing → in-app only |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN` | Optional | Error tracking. Missing → console only |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Optional | Product analytics. Missing → disabled |
| `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | Yes in production | Scheduled job signature verification |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Yes in production | Shared rate limiter (`lib/rate-limit/limiter.ts`). Missing in production → module-level throw. Missing in dev/CI → in-memory fallback |

## Rate limiting

Shared `Ratelimit.fixedWindow` via `@upstash/ratelimit` + `@upstash/redis`. One `Ratelimit` instance per bucket in `lib/rate-limit/limiter.ts`, keyed by `rl:<bucket>:<identifier>`:

| Bucket | Limit | Applied at |
|---|---|---|
| `accept-invite` | 5 per 15 min per IP | `lib/invites/accept.ts` (`lookupInvite`, `acceptInvite`) |
| `invite-create` | 20 per hour per IP | Reserved — wired when `/admin/invites` creation hits the hot path |

Adding a bucket: extend `RATE_LIMITS` in `lib/rate-limit/config.ts` (must set `requests`, `windowMs`, and `upstashWindow`; the two representations must agree since they feed the Upstash path and the in-memory fallback respectively), then call `await consume('<bucket>', identifier)` at the call site.

**Failure modes:**
- Missing env vars in production → module-level throw. A silently-degraded limiter is worse than a 500.
- Missing env vars in dev/CI → in-memory fallback (`lib/rate-limit/in-memory.ts`). Same API; per-process state. Tests exercise this path directly via `consumeInMemory` + `__resetInMemoryBucketsForTests`.
- Runtime Redis error → fail open + log. Rate limiting is best-effort; making it a single point of failure for `/accept-invite` is the wrong trade.

## Offline queue

Client-side Dexie DB: `rinkreports.queued_submissions`. One row per offline-pending submission, keyed on a client-generated UUID that doubles as the server `idempotency_key`.

State machine (see `lib/offline-queue/queue.ts`):

```
queued → in_flight → synced          (network round-trip succeeded)
queued → in_flight → queued (+attempts) → …  (5xx / network; exponential backoff)
queued → in_flight → failed          (4xx validation or 24h retry budget exhausted)
```

Backoff schedule: 1m → 5m → 15m → 1h → 4h → 12h (capped). `created_at + cumulative_backoff > 24h` flips status → `failed`.

The sync loop runs via:
- `online` event listener
- 60s polling interval for backoff-eligibility checks
- Per-session `startQueueSync()` call mounted on any route using `<OfflineQueueBadge />`

Replay uses `/api/offline-submit` which re-issues `submitForm` server-side. Server-side idempotency (`(facility_id, idempotency_key)` partial unique) guarantees at-most-once.

## Notifications

Single table `notifications` (migration `20260424000001`). Kinds are free-form strings matching `^[a-z][a-z0-9_.]*$`. Every mutation goes through `publish_notification(user_id, kind, payload)` SECURITY DEFINER SQL function.

**Email delivery** is controlled by `lib/notifications/email-catalog.ts`: each kind declares an `isEligible(payload)` predicate. Only eligible kinds trigger a Resend send. Facility-level `settings.notifications.email_enabled = false` vetoes email across the board.

Templates live in `lib/notifications/email-render.ts` — one case per kind. Adding a new email-eligible kind requires both a catalog entry and a template case.

**Realtime**: channels default to Supabase's per-row changefeed. The `<NotificationsBell />` currently renders SSR with the unread count; a client-side Realtime subscription is a v2 polish.

## Billing

### Gating middleware

`requireActiveSubscription()` (from `lib/billing/require-active-subscription.ts`) is called at the top of every write-path server action:

| Status | Grace | Non-strict | Strict |
|---|---|---|---|
| `trialing` | — | allow | allow |
| `active` | — | allow | allow |
| `past_due` | `current_period_end > now - 7d` | allow | block |
| `past_due` | older | block | block |
| `canceled` | — | block | block |
| (missing row) | — | block | block |

Reads never call the middleware — RLS still scopes data, so canceled facilities can view history without paying.

### Checkout flow

1. Admin on `/admin/billing` clicks Subscribe → POST `/api/stripe/checkout`
2. Server action calls `createCheckoutSession` with the chosen price
3. User redirected to Stripe-hosted checkout
4. On success, Stripe posts `checkout.session.completed` to `/api/stripe/webhook`
5. Webhook handler:
   - Verifies signature
   - Inserts `billing_events` row (unique `stripe_event_id` makes replay safe)
   - Calls `applyStripeEvent` which flips `facility_subscriptions.status = 'active'` + stores customer/subscription IDs
6. Admin returns to `/admin/billing?checkout=success`

### Webhook retry

Hourly job `/api/jobs/stripe-webhook-retry` re-processes any `billing_events` row with `processed_at IS NULL AND error_if_any IS NOT NULL`. `applyStripeEvent` is idempotent.

## Platform admin shell

All under `/platform-admin/*`. Gated by `requirePlatformAdmin()` (returns 404 for non-admins to hide surface enumeration).

### Impersonation

- POST to `/platform-admin/facilities/[id]/impersonate`
  - Calls `rpc_start_impersonation` (inserts `impersonation_sessions`, writes audit)
  - Sets three httpOnly cookies: `impersonation_facility_id`, `impersonation_platform_admin_id`, `impersonation_last_seen`
  - Redirects to `/admin/` — platform admin now acts AS a facility admin
- On every subsequent request, `lib/supabase/server.ts::createClient` auto-applies `rpc_set_request_vars` if cookies present
  - `current_facility_id()` honors the impersonation session var (from Agent 1a)
  - `audit_log BEFORE INSERT` trigger auto-populates `actor_impersonator_id` (from this migration)
- POST to `/platform-admin/stop-impersonating`
  - Calls `rpc_stop_impersonation` (closes session, audits)
  - Clears cookies

**Idle timeout**: 2 hours. The `impersonation_last_seen` cookie has `maxAge: 7200` and gets refreshed on every authenticated request. When it expires, the other cookies stay but `readImpersonationCookies` returns null, effectively ending the session client-side.

**Global banner**: `<ImpersonationBanner />` (server component) is rendered at the top of `/admin/*` and `/modules/*` layouts. If cookies are present, it shows "Impersonating: Rink Alpha (slug)" with a Stop button.

## Scheduled jobs

Route handlers under `/api/jobs/*`. Each verifies the QStash `Upstash-Signature` header via `verifyQstashRequest`. In development, missing signing keys log a warning and skip verification (so curl-based local testing works).

| Job | Schedule | Owner |
|---|---|---|
| `trial-expiration-check` | daily 00:00 UTC | Agent 7 |
| `trial-ending-notification` | daily 09:00 UTC | Agent 7 |
| `past-due-notification` | daily 09:00 UTC | Agent 7 |
| `stripe-webhook-retry` | hourly | Agent 7 |
| `availability-cutoff-reminder` | daily 09:00 per-facility local | Agent 5 (stubbed here) |
| `ack-reminder` | hourly | Agent 8 (stubbed here) |

Agent 5 and Agent 8 ship their handlers' bodies when they land. The QStash schedule registration lives on the Upstash side — not in code. When deploying, add each schedule in the Upstash console pointing at `https://<app-url>/api/jobs/<slug>`.

## `forceLogoutUser` finalized

`lib/auth/force-logout.ts` is the canonical implementation. Agent 6's contract lives in the file's docstring. Every module imports from `@/lib/auth/force-logout` — no duplicates.

## PWA

`app/manifest.ts` generates `/manifest.webmanifest`. Icons live under `public/icons/` (placeholders in v1 — real art is a design task).

`app/sw.ts` builds to `public/sw.js` via `@serwist/next`. Caching policy:

- Static `/_next/static/*`: cache-first, stale-while-revalidate
- HTML: network-first with preload
- `/api/*`: never cached (excluded by config)

Service worker disabled in development (HMR + cache churn).

## Observability

- `lib/observability/logger.ts` — structured JSON logs, with `withLogging(action, fn)` timing wrapper
- `lib/observability/sentry.ts` — no-op when DSN missing, else dynamic-imports `@sentry/nextjs`
- `lib/observability/posthog.ts` — no-op when key missing; server-side captures respect per-facility `analytics_enabled`

## Tests (pgTAP)

`supabase/tests/17_agent_7.test.sql` — 17 assertions covering:
- Notifications `publish_notification` behavior (known user + unknown user rejection)
- RLS: users see only own notifications
- UPDATE column restriction (read_at only)
- Impersonation flow (start, session vars, audit_log auto-tagging, stop)
- Forged impersonation by non-admin silently noops
- `billing_events` append-only with whitelisted-column UPDATE

## What Agent 7 does NOT ship

- Real Stripe products / prices (env vars; ops task)
- Resend domain DNS (ops task; `onboarding@resend.dev` works for dev)
- Sentry / PostHog accounts (optional; unset → graceful no-op)
- QStash schedule registration (done in Upstash console per environment)
- Icons (placeholder PNGs; design task)

## Known v2 items

- Background-sync in the service worker (Safari limitation blocks universal support)
- Realtime-driven bell icon updates (currently SSR-only)
- Per-facility QStash schedule for `availability-cutoff-reminder` (v1 runs single UTC schedule; Agent 5 can split)
- Admin UI for `facilities.settings.notifications.email_enabled`
- Multi-region deploys (v1 single-region; impersonation cookie semantics assume a single origin)
