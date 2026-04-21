# Agent workflow

Conventions for how agents branch, coordinate, and land work. One page.
If a convention isn't here, look at the last three merged PRs and match them.

Agent 9 owns this file. New conventions get added here in the same PR that
introduces them.

---

## Branch naming

Two patterns, chosen by what the PR does:

| PR type | Pattern | Examples |
|---|---|---|
| Feature / phase | `agent-N/phase-N-short-description` | `agent-2/phase-2-editor-contract`, `agent-5/phase-3-swap-flow` |
| Hardening / hygiene | `agent-N/short-description` (no phase number) | `agent-2/engine-hardening`, `agent-9/search-path-hygiene` |

Rules:
- Use the **feature pattern** when the PR delivers a DoD item from the agent's
  brief. The phase number matches the brief's phase sequencing.
- Use the **hardening pattern** for test coverage, CI fixes, advisor cleanups,
  or anything that doesn't correspond to a brief DoD item. PR #15 established
  this: `agent-2/engine-hardening` was test coverage for already-shipped
  Phase 1, not Phase 2, so it didn't carry a phase number.
- `claude/...` branches are automated verify-worktree artifacts from
  Claude Code's PR verification flow. Ignore them. Never cut work onto one.

The pull request template (`.github/pull_request_template.md`) enforces the
feature pattern in the Agent 9 lane-check. Hardening PRs annotate the
checkbox with "no phase number — maintenance" per the convention used in
#15, #17, #19, #20.

## Parallel lanes

Agents run in parallel. A PR in one lane does **not** block a PR in another
lane unless there's a real dependency.

- **Branch from main**, not from another agent's open branch. If you think you
  need to branch from another agent's work, that's a dependency signal —
  flag it instead of coupling.
- **Merge-order rebases**: whichever of two parallel PRs lands second rebases.
  Conflict resolution in shared files (`KNOWN_GAPS.md`, `RLS_TEST_CATALOG.md`)
  is mechanical — combine strikethrough updates; don't reintroduce resolved
  items.
- **No serialization for coordination's sake.** Don't hold PR B because PR A
  is open in a different lane. That creates false coupling and makes parallel
  agent work meaningless.

## NEXT_SESSION.md

Single source of truth on `main`. Never on a feature branch.

- **Lives on**: `main` only.
- **Updated by**: the final merge of each phase. The phase PR's last commit
  writes the session handoff; the merge makes it visible to the next session.
- **If you see it on a feature branch**: it's drift. Delete it from the
  branch — the copy on `main` is authoritative.

Rationale: coordination state on a feature branch is invisible to other
agents until merge, which defeats its purpose. Same rule applies to any
shared coordination doc (`KNOWN_GAPS.md`, `RLS_TEST_CATALOG.md`) — edits to
these go in the PR that caused the gap, and land with that PR.

## Shared coordination docs

| Doc | Owner | When to touch |
|---|---|---|
| `NEXT_SESSION.md` | Phase-closing PR | Last commit of a phase |
| `KNOWN_GAPS.md` | Any PR that opens or closes a gap | Same PR that creates/resolves the gap |
| `RLS_TEST_CATALOG.md` | Any PR adding a tenant table or RLS test | Same PR |
| `SECURITY_CHECKLIST.md` | Any PR adding a server action or route handler | Same PR |
| `TESTING.md` | Any PR introducing a new test layer or graduation rule | Same PR |
| `FORM_ENGINE.md`, `FORM_SCHEMA_FORMAT.md` | Agent 2 | When the engine contract changes |

Never add a shared-doc edit as a follow-up PR. It decouples the record from
the change it describes and breaks the audit trail.

## Registry drift and escape hatch

When Agent 2's submission registry self-test (Phase 2) catches drift — a
registered module missing `core-fields.ts`, a missing `module_default_schemas`
row, a submission table missing a required column — the default behavior is
**block merge**.

For legitimate exceptions (mid-flight refactor, known-transient state during
a split PR, etc.), bypass via a PR-body line:

```
Registry-Drift-Acknowledged: <one-line reason + expected resolution PR or timeline>
```

CI greps for this exact token in the PR body. Presence turns the self-test
failure into a warning; absence keeps it blocking. Every use is logged to
the PR's CI summary for audit.

This is a pressure-release valve, not continue-on-error. The valve leaves
evidence: the reason string is part of the git-searchable record. If you
find yourself using it more than once per phase per agent, the underlying
convention is wrong — fix that, don't keep acknowledging drift.

## CI job graduation

Non-blocking → blocking promotion rule, established in PR #15's TESTING.md
addition:

- 5 consecutive green PR runs
- No documented flake history in that window
- Underlying surface (fixtures, selectors, schema) is stable
- Promotion order: **unit → integration → pgTAP → e2e → e2e-realtime**
  (ascending flake risk)
- One PR per job, titled `ci: graduate <job> to blocking`

This keeps graduation mechanical and audit-able. Don't bundle a graduation
with feature work — it hides the signal.

## When to flag vs. just do it

- **Just do it**: changes inside your agent's lane, matching the brief's DoD,
  documented in the same PR.
- **Flag first**: touching another agent's migration, adding a column to an
  Agent-1-owned table, changing a shared doc's structure (not just content),
  introducing a new CI job, or anything that breaks the patterns on this
  page.

Flag = open an issue or post on the coordination channel before writing code.
A blocked PR from another agent is more expensive than a five-minute check.
