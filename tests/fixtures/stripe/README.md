# Stripe webhook fixtures

Committed JSON payloads that replay through `/api/stripe/webhook` in
per-PR integration tests. Deterministic, offline, no Stripe secret needed
in CI.

## How to regenerate / add a fixture

Each fixture below was produced by the Stripe CLI against test mode. To
regenerate or add a new event type, run the documented command, pipe stdout to
the JSON file, and commit both the file and the updating command in this
README.

| File | Command |
|---|---|
| `customer.subscription.created.json` | `stripe trigger customer.subscription.created` |
| `customer.subscription.updated.json` | `stripe trigger customer.subscription.updated` |
| `customer.subscription.deleted.json` | `stripe trigger customer.subscription.deleted` |
| `invoice.payment_failed.json` | `stripe trigger invoice.payment_failed` |
| `invoice.payment_succeeded.json` | `stripe trigger invoice.payment_succeeded` |
| `checkout.session.completed.json` | `stripe trigger checkout.session.completed` |

After capturing the JSON, **scrub any real Stripe account IDs** that leak
through (unlikely in test mode but possible). `acct_*` → `acct_TESTACCT`,
`cus_*` → keep the test prefix but anonymize, etc.

## Signature handling

The webhook verifier requires a Stripe signature header. In tests, we compute
the signature at replay time using a known test-only webhook secret
(`STRIPE_WEBHOOK_SECRET=whsec_test_fixture_replay`). The scrubbed fixtures don't
carry a valid signature — the test re-signs them on send.

## What the PR tests cover vs. what nightly covers

- **PR**: fixture replay through `/api/stripe/webhook`. Proves our handler
  processes each event type correctly. Does NOT prove our integration with
  the real Stripe API.
- **Nightly**: `tests/integration/stripe-live.test.ts` hits real Stripe test
  mode and exercises the full round-trip. Catches payload-shape drift when
  Stripe updates their API.

Both surfaces exist because fixture tests alone could let a Stripe payload
schema change ship silently. The nightly test is the canary.
