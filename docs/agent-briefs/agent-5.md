# Agent 5 — Employee Scheduling Module

## Your role
You build the Employee Scheduling module: managers build weekly schedules, staff view their shifts, availability and time-off flow through approval, shifts can be swapped. Custom UI (not schema-driven). You reuse Agent 2's versioning patterns where relevant but mostly build fresh.

## What you can assume exists
- Agent 1a's foundation (`FOUNDATION.md`)
- Agent 1b's `facility_resources` — you reference `resource_type = 'shift_position'` for positions like "Zamboni Driver," "Skate Rental," "Front Desk"
- Agent 1b's `settings jsonb` column on `facilities` — you read from `settings.scheduling.*`
- Agent 2's `FORM_ENGINE.md` — read for pattern familiarity; you don't use the engine itself
- Agent 3's route convention: `/modules/<slug>/...`
- Agent 7's `notifications` table — you publish events; Agent 7 delivers them

**Read `FOUNDATION.md` before starting.** If Agent 7 hasn't shipped notifications yet, stub the notification calls and document the contract; Agent 7 wires them up on landing.

## Product context
Rink staff are mostly part-time hourly. Managers build a schedule weekly — who works what shift in what position. Today this is paper, whiteboard, or a group chat. The tool digitizes:
- The week build (manager-side)
- The personal schedule view (staff-side)
- Availability (staff tells manager when they can work)
- Time-off requests
- Shift swaps (staff ↔ staff, optionally manager approval)

Scheduling is where products like this grow out of control. **You will resist.** Anything that sounds like payroll, time clock, labor cost, forecasting, or AI auto-scheduling is out of v1.

## Stack
Same as everyone else. No third-party scheduling library. React + shadcn Table/Calendar. Desktop-only for the manager builder; mobile-supported for all staff views.

## Decisions locked

- **Week starts Sunday.** Hardcoded in v1.
- **Availability supports both recurring weekly templates AND per-week overrides.** Staff can set a recurring default (e.g., "available Mon–Fri 4–10pm every week") and override specific weeks.
- **Shift positions are `facility_resources` rows** with `resource_type = 'shift_position'`.
- **Schedule publish is a state flip**, not a versioned snapshot. Edits after publish apply immediately and emit notifications to affected staff.
- **Swap approval mode is a facility setting.** `facilities.settings.scheduling.swap_approval_mode` ∈ `'free' | 'manager_approval'`, default `'manager_approval'`. The swap flow branches on this setting — free mode skips the manager step, manager_approval mode requires it.
- **Bulk copy weekly and monthly** included in the manager builder: copy-previous-week and copy-previous-month (replicates shifts but leaves assignments unassigned by default; optionally carry over assignments).
- **Time-off conflicts are warnings, not hard blocks.**
- **Overlapping shifts for the same user are hard-blocked.**
- **Manager week builder is desktop-only.**
- **Minor hour limits are explicitly out of scope.** State-by-state variation makes a one-size rule impossible; rinks handle compliance externally. Document the gap in `SCHEDULING.md`.

## Deliverables

### 1. Schema

#### `schedules`
- `id`, `facility_id`, `week_start_date` (date, always a Sunday)
- `status` — `draft | published | archived`
- `created_by`, `created_at`, `published_at`, `published_by`

Partial unique index on `(facility_id, week_start_date)`.

#### `shifts`
- `id`, `facility_id`, `schedule_id` (fk cascade)
- `position_resource_id` (fk `facility_resources`)
- `starts_at`, `ends_at` (timestamptz in facility timezone)
- `notes`, `required_headcount` int default 1, `created_at`

#### `shift_assignments`
- `id`, `shift_id` (fk cascade), `user_id`
- `assigned_at`, `assigned_by`
- Unique on `(shift_id, user_id)`.

#### `availability_templates` (recurring defaults)
- `id`, `facility_id`, `user_id`
- `day_of_week` (0–6, 0 = Sunday)
- `start_time`, `end_time`
- `status` — `available | unavailable | preferred`
- `created_at`, `updated_at`

Multiple rows per `(user_id, day_of_week)` allowed (e.g., "available 9–12 and 4–10").

#### `availability_overrides` (per-week overrides)
Staff-submitted availability for a specific week, overriding the template.
- `id`, `facility_id`, `user_id`, `week_start_date`
- `day_of_week`, `start_time`, `end_time`, `status`
- `created_at`

A week with any override rows replaces the template for that week's computation. Partial override (e.g., one day only) still replaces the full week's template — staff resubmit the full week when overriding. Document this clearly.

#### `time_off_requests`
- `id`, `facility_id`, `user_id`, `starts_at`, `ends_at`, `reason`
- `status` — `pending | approved | denied | withdrawn`
- `decided_by`, `decided_at`, `decision_note`
- `created_at`, `idempotency_key`

#### `shift_swap_requests`
- `id`, `facility_id`, `requester_user_id`, `requester_shift_id`
- `target_user_id`, `target_shift_id` (nullable — giveaway)
- `status` — `pending_target | pending_manager | approved | denied | withdrawn`
- `target_response_at`, `decided_by`, `decided_at`, `decision_note`
- `created_at`, `idempotency_key`

In `swap_approval_mode = 'free'`, `pending_manager` is skipped — target acceptance flips directly to `approved` and reassigns.

RLS on all seven tables: facility isolation + `has_module_access('scheduling', ...)` with appropriate level-per-action.

### 2. Routes

**Staff views (mobile-supported):**
- `/modules/scheduling/` — my current/upcoming week
- `/modules/scheduling/week/[week-start]` — specific week
- `/modules/scheduling/availability` — edit recurring template + week overrides
- `/modules/scheduling/time-off` — request list + new request
- `/modules/scheduling/swaps` — swap list
- `/modules/scheduling/swaps/new` — propose a swap

**Manager views (desktop-only, mobile shows "open this on desktop" notice):**
- `/modules/scheduling/manage/` — week list with status indicators
- `/modules/scheduling/manage/[week-start]` — week builder grid
- `/modules/scheduling/manage/time-off` — approval queue
- `/modules/scheduling/manage/swaps` — approval queue (manager_approval mode only)

### 3. Manager week builder
- Grid: columns = days (Sun–Sat), rows = positions.
- Click cell → add shift.
- Click shift → assign users, edit, delete.
- Side panel: availability overlay. Computed from `availability_overrides` for the week if any exist, else `availability_templates`. Time-off approvals show as red blocks.
- Conflict warnings: time-off (warn), overlapping assignment same user (hard block).
- **Bulk copy controls:**
  - "Copy previous week" — clones shifts from last week, optionally with assignments.
  - "Copy previous month" — clones shifts from the same calendar week of the prior month.
  - Both prompt before overwriting an existing draft.
- Publish button: flips status, writes audit_log, emits notifications.
- Edit-after-publish: allowed, emits notifications to affected users.

### 4. Staff week view
- Today's shifts at top, upcoming this week below, next week below that.
- Each shift: position name, start–end, notes, co-workers.
- Tap a shift: detail + "request swap" button.

### 5. Availability UI
- Tab 1: "Recurring" — edit `availability_templates` (day-of-week × time blocks).
- Tab 2: "This week / next week" — per-week override; picks from an upcoming week list within the cutoff (configured via `settings.scheduling.availability_cutoff_days`, default 14).
- Default display shows the effective availability for each upcoming week (override if present, else template).

### 6. Time-off flow
- Staff submits a range + reason.
- Manager sees in approval queue; approves or denies.
- Approved time-off shows on manager's availability overlay.
- Approval/denial fires notification.

### 7. Swap flow
Branches on `swap_approval_mode`:

**`manager_approval` mode:**
- Requester proposes → `pending_target` → target notified.
- Target accepts → `pending_manager` → manager notified.
- Manager approves → atomic reassignment in `shift_assignments` + audit_log + both parties notified.

**`free` mode:**
- Requester proposes → `pending_target` → target notified.
- Target accepts → atomic reassignment + audit_log + both parties notified. Manager step skipped.

Manager can still retroactively view swaps in both modes. Any party can withdraw before final approval.

### 8. Notifications (via Agent 7)
Events to publish:
- `schedule.published`
- `schedule.edited_after_publish`
- `time_off.submitted`
- `time_off.decided`
- `swap.proposed`
- `swap.accepted_by_target`
- `swap.decided`
- `availability.cutoff_approaching`

If Agent 7 isn't live yet, stub publish calls to a `pending_notifications` table that Agent 7 drains. Document the stub.

### 9. Permission matrix (add to Agent 3's table)
| Role | Access |
|---|---|
| Admin | admin |
| Manager | write (build, approve, edit published) |
| Staff | write (own availability, time-off, swaps); read (own schedule) |

### 10. Documentation
`SCHEDULING.md` covering:
- Data model + week-boundary rules (Sunday start)
- Availability computation (override > template)
- Manager builder workflow including bulk copy
- Staff workflows
- Notification event catalog
- Swap flow branching on `swap_approval_mode`
- V1 non-feature list
- The minors compliance gap (explicit, with rationale)
- Known settings keys written/read under `facilities.settings.scheduling.*`

## Definition of done — hard gate
- Manager builds a week, assigns staff, publishes; every assigned user notified.
- Staff sees current + upcoming week on mobile.
- Staff sets recurring availability template; sees effective availability per upcoming week; overrides a specific week and verifies the override replaces the template for that week.
- Time-off request flows submit → approve → notify.
- Swap flow in `manager_approval` mode: propose → target accept → manager approve → atomic reassign. In `free` mode: propose → target accept → atomic reassign (no manager step).
- Overlapping assignments hard-blocked; time-off conflicts warn.
- Edit-after-publish notifies only affected users.
- Bulk copy previous week works. Bulk copy previous month works. Existing draft prompts before overwrite.
- RLS: Facility A manager cannot see or edit Facility B data across all 7 tables.
- Idempotency: duplicate time-off request with same key → one insert.
- Manager builder at ≥1024px; staff views at 390px.
- `SCHEDULING.md` exists with non-feature list and minors-gap documentation.

## Non-features — explicit v1 rejections
- Time clock / clock-in clock-out
- Payroll export
- Labor cost calculation
- Forecasting
- AI auto-scheduling
- Minor-hours legal compliance enforcement (state variance out of scope)
- Shift templates (reusable shift definitions across weeks)
- Staff-to-staff messaging within the module
- iCal / Google Calendar export
- Mobile manager builder

## What you do NOT build
- Admin config UI for cutoff windows, shift positions, swap mode — Agent 6
- `facility_resources` table or `resource_type = 'shift_position'` seeding — Agent 1b + Agent 6
- Notifications table or delivery — Agent 7
- Any rejected-list item

## Constraints
- Browser-only workflow, code inline.
- Do not modify Agent 1a, 1b, 2, 3 code. Extend only.
- Desktop manager builder is desktop-only by design.
- If notifications aren't live, stub behind a documented contract.
- Do not invent a permission model. Use `role_module_access` with `scheduling` slug.

## First response
Do NOT write code. Deliver:
1. Confirm you've read `FOUNDATION.md`, `ONBOARDING.md`, (if available) `FORM_ENGINE.md`, `PLATFORM.md`.
2. 7-table DDL sketch in prose.
3. Availability computation algorithm: how override + template resolve into effective availability.
4. Wireframe-in-words of the manager week builder at 1280px, including bulk copy controls.
5. Wireframe-in-words of the staff week view at 390px.
6. Swap state machine diagram branching on `swap_approval_mode`.
7. Notification event catalog with payload shapes.
8. `facilities.settings.scheduling` key catalog (keys, types, defaults).
9. Open questions.

Wait for approval before writing code.
