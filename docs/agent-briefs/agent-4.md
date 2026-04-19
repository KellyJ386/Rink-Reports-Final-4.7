# Agent 4 — Ice Depth Module

## Your role
You build the Ice Depth module: a custom-UI module (not schema-driven) where staff record ice thickness measurements at fixed points on a rink surface. You are the first agent to ship a module that doesn't use Agent 2's form engine. You will reuse Agent 2's *patterns* (template versioning, history pinning, standard submission columns) without reusing its *components*.

## What you can assume exists
- Agent 1a's foundation (`FOUNDATION.md`)
- Agent 1b's `facility_resources` (you reference `resource_type = 'surface'`)
- Agent 1b's `module_default_schemas` and `enableModule` — not relevant to you (no form_schemas), but read so you know what's there
- Agent 2's `FORM_ENGINE.md` patterns: template versioning, draft/publish state machine, pinned-version-on-submission, standard submission columns. Read it. Mirror the patterns exactly even though you're not using the engine.
- Agent 3's route convention: `/modules/<slug>/...`

**Read `FOUNDATION.md` and `FORM_ENGINE.md` before starting.**

## Product context
Ice thickness varies across a rink. A spot that's too thin is a safety risk. Rinks measure thickness at standard points on a fixed schedule — typically weekly — and track trends to know when to add water. Today this is paper: a rink diagram with circles and pencil-written depths.

The module needs:
- A **template** per surface defining the SVG and the measurement points (location + label).
- A **session** workflow: pick surface → tap each point → enter depth → complete.
- A **trend view**: per-point line chart over time, plus a last-session SVG overlay color-coded by thickness.

## Stack
Same as everyone else. Recharts for trends. Plain React + SVG for the rink diagram (no D3). No form engine.

## Decisions made (defaults)

- **Units:** millimeters. Display only; storage is numeric. No inch toggle in v1.
- **SVG source:** ship 3 bundled SVGs as code assets — `nhl`, `olympic`, `studio`. Admins pick one per template. No file upload in v1.
- **Measurement points:** admin-defined per template. Each starter SVG ships with 8 default point coordinates.
- **Template versioning:** mirrors Agent 2's form_schemas — current + draft state, version int, history table, pinned version on each session.
- **Permissions:** template editing = Admin only. Session running = anyone with Ice Depth write access.
- **No alerting in v1.** Thin-ice notifications are v2.
- **No export in v1.** No CSV, no PDF, no email digests.

## Deliverables

### 1. Schema

#### `ice_depth_templates`
One row per `(facility_id, surface_resource_id)`. Mirrors `form_schemas` shape.
- `id`, `facility_id`, `surface_resource_id` (fk `facility_resources`)
- `name`
- `svg_key` text — `'nhl' | 'olympic' | 'studio'`
- `current_points` jsonb — array of `{ key, label, x_pct, y_pct, sort_order }`
- `draft_points` jsonb (nullable)
- `version` int (monotonic, increments on publish)
- `is_published` bool
- `updated_at`, `updated_by`

Partial unique index on `(facility_id, surface_resource_id)`. Stable point `key` (snake_case) — labels editable, keys are not.

#### `ice_depth_template_history`
Append-only snapshot per publish. `id, facility_id, template_id, version, svg_key, points jsonb, published_by, published_at`. Unique on `(template_id, version)`.

#### `ice_depth_sessions` (the submission table)
Standard submission columns per Agent 2's contract:
- `id`, `facility_id` (default `current_facility_id()`), `submitted_by`, `submitted_at`
- `template_id` (fk), `template_version` (pinned at insert)
- `surface_resource_id` (denormalized)
- `notes` text
- `idempotency_key` text + partial unique on `(facility_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
- `custom_fields jsonb default '{}'` (unused in v1; kept for parity)
- `form_schema_version int not null` (set equal to `template_version`)

#### `ice_depth_readings`
- `id`, `session_id` (fk, cascade), `point_key`, `depth_mm` numeric, `recorded_at`
- Composite unique on `(session_id, point_key)`

RLS on all four tables: facility isolation + `has_module_access('ice_depth', ...)`.

### 2. Routes
- `/modules/ice-depth/` — session history
- `/modules/ice-depth/new` — start a session
- `/modules/ice-depth/[session-id]` — detail view
- `/modules/ice-depth/[session-id]/run` — session-running UI
- `/modules/ice-depth/trends` — per-point trend chart
- `/modules/ice-depth/templates` — admin template list (Admin only)
- `/modules/ice-depth/templates/new`
- `/modules/ice-depth/templates/[template-id]/edit`

### 3. Session-running UI
- SVG fills viewport. Each point ≥44px circle with label.
- Tap point → modal with numeric soft-keyboard input.
- Saved points visually distinguished.
- Progress indicator: "5 of 8 readings recorded."
- "Complete session" enabled only when all points have readings.
- Two-finger pinch-zoom on the SVG enabled.
- Works one-handed on iPhone at 390px.

### 4. Detail view
- SVG with each point colored by depth (cool→warm gradient).
- Table beneath: point label, reading, recorded_at.
- Session metadata: surface, template version, who, when, notes.

### 5. Trend view
- Filter by surface (required), date range (default last 90 days).
- Line chart: X = session date, Y = depth_mm, one line per point.
- Lines keyed on point `key`; template changes preserve continuity.

### 6. Template editor (admin)
- Pick `svg_key`, name the template.
- Click SVG to add a point; drag to reposition; click to label/rename/delete.
- Save draft / publish / discard draft — mirrors Agent 2's state machine.
- Publish snapshots to `ice_depth_template_history`, bumps version, writes audit_log.
- Validation: ≥1 point, unique keys, non-empty labels.

### 7. Server actions
- `startSession({ template_id, idempotency_key })` → returns session_id (idempotent)
- `recordReading({ session_id, point_key, depth_mm })` → upserts on `(session_id, point_key)`
- `completeSession({ session_id })` → validates all template points have readings, writes audit_log
- `publishTemplate({ template_id })` → snapshot + version bump + audit_log
- All actions: facility_id from `current_facility_id()`, never client; check module access; write audit_log

### 8. Documentation
`ICE_DEPTH.md` covering: data model, template versioning, session lifecycle, bundled SVG catalog, trend chart logic, mobile UX notes, v1 boundaries.

## Definition of done — hard gate
- Admin creates a template, picks a starter SVG, places ≥1 point, publishes. Audit log entry exists.
- Staff at Facility A runs a session: starts, taps every point, enters readings, completes. Session appears in history.
- Detail view renders SVG with readings overlay.
- Trend chart renders for any point on any surface with ≥2 sessions.
- Editing a published template + republish creates a new version; sessions filed under v1 still render against v1.
- Mobile: 390px iOS Safari, ≥44px tap targets, pinch-zoom works.
- RLS: Facility A user cannot SELECT/INSERT/UPDATE/DELETE any Facility B template, session, or reading.
- Idempotency: same `idempotency_key` → same session id, one insert.
- 3 bundled SVGs render correctly.
- `ICE_DEPTH.md` exists.

## What you do NOT build
- Form engine integration
- Custom SVG upload (v2)
- Thickness alerting / notifications (v2)
- Export (v2)
- Inter-rink benchmarking (out of scope)
- Skip-point-with-reason workflow (v2)
- Templates shared across facilities
- Editing the SVG asset itself

## Constraints
- Browser-only workflow, code inline.
- Do not modify Agent 1a, 1b, 2, 3 code. Extend only.
- Do not introduce a new permission model. Use Agent 1's `role_module_access` with module slug `ice_depth`.
- Do not use Supabase Storage. SVGs are bundled in `app/modules/ice-depth/svgs/`.
- Mirror Agent 2's draft/publish/version/history pattern even though you're not using the engine.

## First response
Do NOT write code. Deliver:
1. Confirm you've read `FOUNDATION.md` and `FORM_ENGINE.md`.
2. Sketch of the 4 tables in prose.
3. Default 8-point coordinates for each of the 3 bundled SVGs (key, label, x_pct, y_pct).
4. Wireframe-in-words of the session-running UI on 390px.
5. Trend chart behavior when a template version changes points.
6. Server action signatures with idempotency notes.
7. Open questions.

Wait for approval before writing code.
