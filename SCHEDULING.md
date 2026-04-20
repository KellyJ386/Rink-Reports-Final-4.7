# Employee Scheduling module

Weekly schedules, availability, time-off, shift swaps. Agent 5.

## Scope

**In:**
- `schedules` + `shifts` + `shift_assignments` with the full draft → published → archived lifecycle
- Recurring availability templates + additive per-day, per-week overrides
- Time-off requests with approval / denial / withdraw
- Shift swap flow branching on `swap_approval_mode` (manager-approval default, free mode skips the manager step)
- Manager week builder grid (desktop-only — mobile shows a notice)
- Staff week view, availability editor, time-off, swaps (all mobile-supported)
- Copy-previous-week and copy-28-days-back bulk shift copy
- Daily availability-cutoff-reminder scheduled job
- Notifications via Agent 7 catalog (`schedule.*`, `time_off.*`, `swap.*`, `availability.*`)

**Non-features (v1):**
- Time clock, clock-in/clock-out
- Payroll export, labor cost, forecasting, AI auto-scheduling
- Minor-hours legal compliance (state variance makes a one-size rule impossible — rinks handle externally; see below)
- Reusable shift templates across weeks
- Staff-to-staff messaging
- iCal / Google Calendar export
- Mobile manager builder

## Data model (7 tables)

```
schedules            id, facility_id, week_start_date (Sunday CHECK),
                     status draft|published|archived, created_by,
                     published_at/by, archived_at/by
                     UNIQUE(facility_id, week_start_date)

shifts               id, facility_id, schedule_id,
                     position_resource_id → facility_resources
                       (trigger: resource_type='shift_position' & same facility),
                     starts_at, ends_at, notes, required_headcount
                     GiST index on tstzrange(starts_at, ends_at)

shift_assignments    id, shift_id, user_id, assigned_at, assigned_by
                     UNIQUE(shift_id, user_id)
                     trigger: user facility = shift facility
                     trigger: overlap-block — same user + ±24h tstzrange
                       overlap + non-archived schedule → SQLSTATE 23P01

availability_templates   recurring per (user, day_of_week). Multiple blocks allowed per day.
availability_overrides   per (user, week_start_date, day_of_week).
                         Day-level additive on top of template.

time_off_requests        pending | approved | denied | withdrawn.
                         schedule_adjusted_before_withdraw flag for post-approval withdrawals.
                         Partial unique on (facility, idempotency_key).

shift_swap_requests      pending_target → pending_manager → approved/denied (or withdrawn).
                         pending_manager is skipped in swap_approval_mode='free'.
                         Partial unique on (facility, idempotency_key).
```

## Audit_log emissions

Structural events only — we do not log every `INSERT shift_assignments`. The set
you would actually want to replay:

- `schedule.published` — from `rpc_publish_schedule`
- `schedule.reopened`  — from `rpc_reopen_schedule`
- `schedule.archived`  — from `rpc_archive_schedule`
- `swap.approved`      — from `rpc_swap_accept` (free mode) + `rpc_swap_manager_decide` (manager mode)
- `swap.rejected`      — from `rpc_swap_manager_decide` (denied)
- `time_off.decided`   — from `rpc_time_off_decide`
- `time_off.withdrawn_after_approval` — from `rpc_time_off_withdraw` when previous status was approved

Per-assignment writes would drown the real events. If you need per-assignment
history someday, wire it to a dedicated table rather than dumping into audit_log.

## Permission matrix

| Role            | `has_module_access('scheduling', ...)` | Can do                                                           |
|-----------------|----------------------------------------|------------------------------------------------------------------|
| Staff           | `'write'`                              | Submit own availability + time-off + swap proposals; view own schedule |
| Manager         | `'admin'`                              | Build + publish schedules; approve time-off; approve swaps       |
| Facility Admin  | `'admin'`                              | Same as Manager plus facility-level config (owned by Agent 6)    |

Why `admin` rather than `write` for managers: `write` is inherited by Staff,
which would let a cashier approve their coworker's time-off. The module-access
levels map to action scopes: `read` = see own/assigned, `write` = submit own
requests, `admin` = approve + build + audit across the facility.

This pattern generalises: future modules with a "Manager approves Staff"
dynamic should adopt the same mapping.

## Week boundary

v1 locks Sunday as the first day of the week. CHECK constraints on
`schedules.week_start_date` and `availability_overrides.week_start_date`
enforce `EXTRACT(DOW) = 0`.

## Availability computation (additive per-day overrides)

For a given (user, week) pair, the effective availability is computed by:

```
for each day_of_week 0..6:
  if override rows exist for (user, week, day_of_week):
    use those rows                          # 'override' source
  elif template rows exist for (user, day_of_week):
    use those rows                          # 'template' source
  else:
    return no rows for that day             # "no availability submitted"
```

The SQL function `effective_availability_for_week(user_id, week_start_date)`
encapsulates this and returns rows with a `source` column ('override' |
'template').

**Why additive** rather than "any override replaces the whole week"? It matches
how every other scheduling product (Deputy, WhenIWork, 7shifts) works, and
staff who want to override a single bad day don't have to re-submit the other
six. The alternative was considered and rejected during design.

**Three UI states per day:**
1. **Template applies** — day falls back to recurring rule
2. **Override says X** — day has explicit override rows this week
3. **No availability submitted** — neither template nor override for this day

Manager-facing views treat state 3 as a warning, not a hard block — a schedule
can still be published for a staff member who didn't submit availability. The
availability-cutoff-reminder job nudges them before their next week's deadline.

## Swap state machine

```
                              manager_approval mode
                                     ┌──────────────────┐
propose                              │                  │
  │                                  ▼                  │
  ▼                       accept                       approved
pending_target  ─────▶  pending_manager  ───(approve)──▶  (reassigned atomically)
  │                          │
  │ withdraw / deny           │ deny
  ▼                          ▼
denied / withdrawn          denied

                               free mode
propose
  │
  ▼
pending_target  ──accept──▶  approved (reassigned atomically)
  │
  │ withdraw
  ▼
withdrawn
```

Reassignment is handled by `_internal_swap_reassign` (SECURITY INVOKER
internal helper): DELETE old assignments, INSERT new ones, mirror if the swap
is two-way. The overlap-block trigger on `shift_assignments` fires per row; if
a user's new assignment would overlap another shift, the INSERT raises
SQLSTATE 23P01 and the surrounding RPC aborts atomically.

Requester + target both receive `swap.decided` on approval. In
manager-approval mode, target acceptance sends `swap.accepted_by_target` to
requester + all managers.

## Time-off withdraw semantics

Staff can `Withdraw` any of their own requests in `pending` or `approved` state
(`denied` → cannot withdraw; `withdrawn` → already done).

On withdraw-of-approved:
1. Status flips to `withdrawn`.
2. `schedule_adjusted_before_withdraw = true` is stamped.
3. `decision_note` is appended with `[withdrawn after approval; schedule was not auto-reverted]`.
4. `audit_log` records `time_off.withdrawn_after_approval`.
5. The originally-approving manager receives a `time_off.withdrawn_after_approval` notification.

**Schedules are NOT auto-reverted.** If the manager had already rearranged
shifts based on the approval, that rearrangement stands. Manager contacts
staff manually if they want to reverse it. Rationale: auto-revert surfaces
"mystery shifts" to other staff who thought their week was settled; manual
handling keeps managers in the loop.

## Overlap-block rule

The `shift_assignments` overlap-block trigger rejects an INSERT/UPDATE when
the target row's user is already assigned to a shift whose `tstzrange`
overlaps within ±24h, excluding shifts whose schedule is `archived`. Raises
SQLSTATE `23P01` (`exclusion_violation`) with hint
`conflicting_shift_id=<uuid>`. Server actions translate this into the UX copy
&ldquo;This staff member is already on an overlapping shift within the same week
(±24h).&rdquo;

## Copy-previous semantics

Both options compute the **source week** deterministically:

- `copy previous week` → `target_week - 7 days`
- `copy 4 weeks back`   → `target_week - 28 days` (4 Sundays back)

We deliberately do NOT support "same calendar week of last month" — week-of-
month isn't a stable concept (some months have 4 weeks, some 5), and any
tiebreaker is confusing. 28 days is easy for managers to explain.

`include_assignments` carries over `shift_assignments` on a best-effort basis:
individual INSERTs that would violate the overlap-block trigger are silently
skipped and logged at info level — the copy itself proceeds.

If the target week already has draft shifts, the copy prompts for confirmation
before replacing them.

## Scheduled job: availability-cutoff-reminder

Daily at `/api/jobs/availability-cutoff-reminder`. QStash-signed. Wrapped in
`logScheduledJobRun('availability-cutoff-reminder', ...)` so
`/platform-admin/health` sees per-run counters + durations.

Per facility, reads `settings.scheduling.availability_cutoff_days` (default
14), iterates upcoming weeks within that window, and nudges any active user
who has:

- No `availability_templates` rows at all
- AND no `availability_overrides` rows for that specific week

Dedup via a NOT EXISTS against `notifications` keyed on
`(user_id, (payload->>'week_start_date'))` within last 24h. Partial expression
index `notifications_availability_cutoff_idx` keeps the lookup fast.

## `facilities.settings.scheduling` key catalog

| Key                              | Type                                | Default              | Writer             | Reader                         |
|----------------------------------|-------------------------------------|----------------------|--------------------|--------------------------------|
| `swap_approval_mode`             | `'free' \| 'manager_approval'`      | `'manager_approval'` | Agent 6 Phase 5    | `lib/scheduling/settings.ts`   |
| `availability_cutoff_days`       | int ≥ 1                             | `14`                 | Agent 6 Phase 5    | Availability UI + cutoff job   |

No other scheduling keys. `ADMIN.md` hosts the platform-wide catalog; this
table is the scheduling-scoped subset.

## Minors compliance — explicit gap

State-by-state (and province-by-province in Canada) minor-hour rules vary too
much for a single in-app enforcement to be correct. We do **not** enforce
minor hours at v1. Rinks that employ minors handle compliance externally.

If you wanted to add it later, the hook points would be:
- A per-user `birth_date` column (currently not stored)
- A trigger on `shift_assignments` that consults a per-state rule table
- A facility setting flagging "minor rules active"

We're not doing any of that in v1. Documented gap, intentional.

## Notifications — full catalog for the module

| Kind                                  | Recipients                         | Email-eligible | Email catalog entry |
|---------------------------------------|------------------------------------|----------------|---------------------|
| `schedule.published`                  | All assigned staff                 | Yes            | Agent 7 (pre-existing) |
| `schedule.edited_after_publish`       | Users whose assignments changed    | Yes            | Agent 7 (pre-existing) |
| `swap.proposed`                       | Swap target                        | Yes            | Agent 7 (pre-existing) |
| `swap.accepted_by_target`             | Requester + managers (mgr mode)    | No (in-app)    | Agent 7 (pre-existing) |
| `swap.decided`                        | Both parties                       | Yes            | Agent 7 (pre-existing) |
| `time_off.submitted`                  | Managers                           | No (in-app)    | Added by Agent 5 |
| `time_off.decided`                    | Requester                          | Yes            | Agent 7 (pre-existing) |
| `time_off.withdrawn_after_approval`   | Originally-approving manager       | No (in-app)    | Added by Agent 5 |
| `availability.cutoff_approaching`     | Staff without availability         | Yes            | Added by Agent 5 |

## Files

```
supabase/migrations/
  20260426000001_scheduling_tables.sql
  20260426000002_scheduling_triggers.sql
  20260426000003_scheduling_fns.sql
  20260426000004_avail_cutoff_reminder_index.sql

lib/scheduling/
  types.ts
  week.ts               (Sunday-based week math)
  settings.ts           (read settings.scheduling.* with defaults)
  schedule.ts           (create, publish, reopen, archive, fetch)
  shifts.ts             (add/update/delete + assign/unassign with overlap translation)
  availability.ts       (fetch/replace template + overrides; RPC wrapper)
  time-off.ts           (submit, decide, withdraw; notifies managers)
  swap.ts               (propose, accept, manager decide, withdraw)
  copy.ts               (copyShifts — previous-week, 4-weeks-back)

app/modules/scheduling/
  page.tsx                                (staff: current week)
  week/[week-start]/page.tsx              (staff: any week)
  availability/page.tsx + client.tsx      (template + override tabs)
  time-off/page.tsx + client.tsx          (submit + list + withdraw)
  swaps/page.tsx + client.tsx             (list + accept + withdraw)
  swaps/new/page.tsx + client.tsx         (propose)
  manage/page.tsx                         (manager: week list)
  manage/create-button.tsx
  manage/[week-start]/page.tsx + builder-client.tsx   (week builder grid)
  manage/time-off/page.tsx + client.tsx   (approval queue)
  manage/swaps/page.tsx + client.tsx      (approval queue)
  actions.ts                              (server actions, subscription-gated)
  admin-check.ts

app/api/jobs/availability-cutoff-reminder/route.ts

lib/notifications/email-catalog.ts        (+ time_off.submitted, availability.cutoff_approaching, time_off.withdrawn_after_approval)
lib/notifications/email-render.ts         (+ templates for the new kinds)
```

## Known gaps + later work

- **Week builder availability overlay**: the grid shows assignments but does
  not yet overlay each candidate's effective availability as a coloured
  background. The RPC + lib are ready (`fetchEffectiveAvailability`); the UI
  wiring is Agent 9's polish pass.
- **Time-off conflict warnings on the builder**: approved time-off should show
  as a red stripe on the builder row. Same status as the availability overlay —
  data is ready, visual is not.
- **Target-shift picker for swap proposals**: v1 asks the staff member to
  paste a shift ID. Ugly but functional; a proper picker (see co-workers on a
  given day, pick one of their shifts) is a polish item.
- **Realtime for approval queues**: today, managers refresh. A Realtime
  subscription to `time_off_requests` / `shift_swap_requests` status changes
  is straightforward; not v1.
- **Facility-timezone handling for copy**: the copy helper offsets by UTC-day
  boundaries. Facilities that cross a DST boundary between source and target
  weeks will see a 1-hour drift on copied shifts. Document + warn in the UI
  when this would happen; proper TZ-aware copy is a v2 item.
