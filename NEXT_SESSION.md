# Next session — starting instruction

**Paste this as the first message in a fresh Claude Code conversation:**

> Load Agent 2 brief from `docs/agent-briefs/agent-2.md`. Confirm the following
> PRs have merged to `main` (if not, note it but don't block on them):
>
> - #15 `agent-2/engine-hardening` — test coverage for form engine
> - #17 `agent-3/module-hardening` — Agent 3 standalone-table per-op attacks
> - #19 `agent-9/search-path-hygiene` — trigger search_path migration
> - #20 `agent-9/auth-uid-hoisting` — RLS planner InitPlan hoisting
> - #21 `agent-9/perf-seed-foundation` — realistic-volume seed + first perf test
>
> Then propose **Agent 2 Phase 2 (feature-scope)**: the editor contract,
> option lists graduation, and submission registry. This is the original
> brief's Phase 2, not a rename of hardening work. Scope should focus on the
> **seams that unblock Agents 3 and 6** — Agent 3 needs the submission
> registry to stamp the seven form types across three modules; Agent 6 needs
> the editor contract to finish the form schema editor UI.
>
> Deliver the first-response plan with open questions before writing code.

## What to skip in the plan

Housekeeping that doesn't block Phase 2:

1. **Stripe fixture JSON files** — needs `stripe trigger` CLI in an environment where I can auth. One hour of work whenever convenient. Don't block Phase 2.
2. **Integration + E2E graduation to blocking** — needs real-auth-flow test-facility factory. Lands alongside the next E2E test that genuinely needs it, not as standalone infrastructure.
3. **Ice Depth pgTAP UPDATE/DELETE** — nice-to-have, same template as `21_form_engine_per_op_attacks`. Not on the critical path.
4. **Rate limiter implementation** — decision locked to Upstash in `KNOWN_GAPS.md`. Implementation lands with the next Agent 7 feature pass, not as standalone work.

## After tomorrow's first-response plan

Agent 2 Phase 2 is the biggest single unblock in the build. Everything else waits.

---

Delete this file in the PR that opens Agent 2 Phase 2.
