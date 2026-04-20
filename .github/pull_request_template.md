<!--
  Every PR targets a specific brief + phase. The branch name must match the
  pattern `agent-N/phase-N-description`. CI runs automatically; Agent 9's
  review is the last gate, not the only gate.
-->

## Brief

- **Agent:** <!-- e.g. Agent 5 — Employee Scheduling -->
- **Phase:** <!-- e.g. Phase 2 — Publish flow -->
- **Brief file:** <!-- e.g. docs/agent-briefs/agent-5.md -->

## Acceptance criteria

<!-- Check each DoD item from the brief that this PR addresses. -->

- [ ]
- [ ]
- [ ]

## Tests added / updated

<!--
  Every mutation path needs a test. List concrete file paths, not "added tests".
  Acceptable: "tests/unit/scheduling/week.test.ts — week math edges"
-->

-

## Breaking changes to prior agents

<!--
  Default: none. If this PR touches any prior agent's code, list what + why.
  Agent 9 will block a PR that silently mutates another agent's contract.
-->

None.

## Checklist (Agent 9's lane-check)

- [ ] Branch name follows `agent-N/phase-N-description`
- [ ] RLS_TEST_CATALOG.md updated if new tenant tables were added
- [ ] SECURITY_CHECKLIST.md updated if new server actions / route handlers were added
- [ ] `facility_id` never accepted from client in any new write path
- [ ] Zod validation at every client boundary
- [ ] Audit log entry on every structural mutation (not every row-level write)
