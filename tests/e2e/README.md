# E2E tests

Playwright. One test per critical path. Isolated data per test; use factories
in `tests/factories/` for scratch state.

## Tagging

Tests must be tagged in their `test()` title, not via metadata:

| Tag | When to use |
|---|---|
| `@realtime` | Test exercises Supabase Realtime websockets. Runs in isolated CI job with `retries: 1`. |
| `@slow` | Test reliably exceeds 30s wall time. Nightly only. |
| `@mobile` | Test must run in a 390px viewport. Routed to the mobile-chromium project. |
| `@a11y` | Accessibility assertion; uses axe-core. |

Example:
```ts
test('urgent announcement reaches staff within 10s @realtime', async ({ page }) => { ... })
```

## Priority paths (Agent 9 phase-1 scope)

1. `bootstrap.spec.ts` — platform admin creates facility → first admin accepts invite → dashboard
2. `form-submission.spec.ts` — Circle Check submit → history → detail → audit log row
3. `permission-gate.spec.ts` — staff user hitting `/admin/*` is 404'd, no data leak

## Deferred (tracked in KNOWN_GAPS.md)

Paths 4–11 from Agent 9's brief land in phase 2. See KNOWN_GAPS.md for
sequencing.
