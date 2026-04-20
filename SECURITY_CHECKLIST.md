# Security checklist

One row per server action or route handler. Reviewed at PR time. Agent 9's
review is the gate; CI automates item (1) via `scripts/check-client-facility-id.sh`.

## The 8 items

Every server action and every route handler must satisfy:

1. **`facility_id` never from client for writes** — sourced from `current_facility_id()` in DB DEFAULT, or looked up server-side from a trusted FK (e.g., `roles.facility_id`). Never accepted in a Zod input schema, request body, or form data. Automated: `scripts/check-client-facility-id.sh` runs in PR CI.
2. **Authentication checked** — `supabase.auth.getUser()` returns a user, or the path uses a verified webhook signature (`verifyQstashRequest`, Stripe sig check).
3. **Role / module permission checked** — `has_module_access(slug, level)` RPC or equivalent, called before any mutation.
4. **Input Zod-validated** — every client-supplied field has a validator. No spread of untrusted input into a DB payload.
5. **No SQL string interpolation** — Supabase client only; raw SQL goes through parameterized `.rpc()` calls.
6. **Errors don't leak** — no stack traces or DB error messages returned to the client. Server logs get the detail; the response gets a stable error code.
7. **Rate-limited where hostile input possible** — accept-invite, login, webhook endpoints. Known gaps listed below.
8. **Audit log entry on mutations** — every structural change writes to `audit_log` with actor + action + entity_type + metadata. Per-row churn does NOT go here (see SCHEDULING.md for the shape).

## Coverage grid

| Path | Owner | (1) | (2) | (3) | (4) | (5) | (6) | (7) | (8) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| `app/modules/ice-maintenance/*/new/actions.ts` | Agent 3 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | Idempotency key required |
| `app/modules/ice-depth/**/actions.ts` | Agent 4 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | |
| `app/modules/communications/actions.ts` | Agent 8 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | `postAnnouncement` |
| `app/modules/scheduling/actions.ts` | Agent 5 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | All RPCs are SECURITY DEFINER |
| `app/admin/**/actions.ts` | Agent 6 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | `setSetting` enumerated keys only |
| `app/api/accept-invite/route.ts` | Agent 1b | ✓ | N/A | N/A | ✓ | ✓ | ✓ | ⚠ | ✓ | Rate limit: in-memory bucket (GAP: no cluster-wide limiter — see KNOWN_GAPS.md) |
| `app/api/stripe/webhook/route.ts` | Agent 7 | ✓ | signature | N/A | ✓ | ✓ | ✓ | — | ✓ | Verifies Stripe signature; rejects replay |
| `app/api/jobs/*/route.ts` | Agent 7 + 5 + 8 | N/A | QStash sig | N/A | — | ✓ | ✓ | — | ✓ | Service role only; no user input |
| `app/api/offline-submit/route.ts` | Agent 7 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | Delegates to module actions |
| `app/platform-admin/**/actions.ts` | Agent 7 | ✓ | ✓ | platform-admin check | ✓ | ✓ | ✓ | — | ✓ | `requirePlatformAdmin()` |

Legend: `✓` covered, `—` not applicable, `⚠` partial with known gap, `N/A` by definition.

## Known gaps (cross-linked from KNOWN_GAPS.md)

- **Rate limiting**: only `/api/accept-invite` has rate-limit logic, and it's
  in-memory (not cluster-wide). Before multi-instance deploy we need a
  shared limiter (Upstash or equivalent). Tracked as a phase-2 Agent 9 item.
- **`/api/stripe/webhook` rate-limit**: relies on Stripe's signature check
  as the implicit gate. An attacker with a valid webhook secret could replay;
  we mitigate via the `billing_events.stripe_event_id` unique constraint
  (same event_id → second INSERT throws). Acceptable for v1.

## Adding a new server action — what to check

1. Does the action write to the DB? If yes, every item in this checklist applies.
2. Is `facility_id` in the function signature? **Never.** Source it from `current_facility_id()`.
3. Is there a Zod schema for the input? Add one even for single-field actions.
4. Is the mutation structural? Add an `audit_log` INSERT. If it's per-row churn (e.g. every form field save), don't — drown-the-audit-log is a real failure mode.
5. Update this doc's coverage grid.

A new action that ships without an audit entry on its structural mutation
will be flagged. A new action that accepts `facility_id` from the client
will be flagged and its PR blocked at the `check-client-facility-id.sh` step.
