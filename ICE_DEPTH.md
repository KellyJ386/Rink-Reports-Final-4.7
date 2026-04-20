# ICE_DEPTH.md

The Ice Depth module. Custom UI, not schema-driven — shipped by Agent 4. Mirrors Agent 2's patterns (template versioning, draft/publish state machine, pinned version on every submission, append-only history) without reusing the form engine.

**Read `FOUNDATION.md` and `FORM_ENGINE.md` before extending this module.** The patterns here must stay aligned with the form engine or future agents will find them jarring.

---

## What it does

Staff record ice thickness measurements at fixed points on a rink surface. Admins create a per-surface **template** (SVG backdrop + point layout); staff run **sessions** against that template, tapping each point and entering a depth in millimeters.

Out of scope in v1 (per the brief, keep deferred):

- Thickness alerting / push notifications
- Skip-a-point with a reason (`status = 'abandoned'` enum exists but no user action invokes it)
- Custom SVG upload
- CSV / PDF / email export
- Inter-rink benchmarking
- Editing the SVG asset itself

## Data model

Four tables. All follow `FOUNDATION.md`'s tenant-scoped recipe.

| Table                         | Purpose                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `ice_depth_templates`         | One per `(facility, surface)`. Current + draft points. Versioned.       |
| `ice_depth_template_history`  | Append-only snapshot per publish. Session detail reads here.            |
| `ice_depth_sessions`          | Submission table. Standard columns + `template_id`, `status`.           |
| `ice_depth_readings`          | One per `(session, point_key)`. Upsert-friendly composite unique index. |

Key invariants:

- Template `svg_key` ∈ `'nhl' | 'olympic' | 'studio'` — one of three bundled SVG backdrops.
- Points stored as percentages (`x_pct`, `y_pct` ∈ 0–100) so the layout is viewBox-invariant.
- `surface_resource_id` trigger enforces the resource is actually `resource_type = 'surface'`.
- Session pins `form_schema_version` at start; detail views read the matching `ice_depth_template_history` snapshot.
- Publish rejects drafts that drop any `point_key` referenced by historical readings (rpc_publish_ice_depth_template).

## Permissions

- **Admin (on Ice Depth module):** create/edit/publish templates + everything below.
- **Write (Manager, Staff):** start sessions, record readings, complete sessions, view trends and detail.
- **Read-only:** not used in v1; no role ships with only read on Ice Depth.

Scope decision: template editing uses `has_module_access('ice_depth', 'admin')`, not `admin_control_center`. This lets a facility grant Ice Depth admin to a specific Manager without opening the full admin shell.

## Routes

```
/modules/ice-depth/                      session history
/modules/ice-depth/new                   pick a template, start a session
/modules/ice-depth/[id]                  session detail (read-only)
/modules/ice-depth/[id]/run              session runner (tap points, enter readings)
/modules/ice-depth/trends                per-surface trend chart
/modules/ice-depth/templates             admin template list
/modules/ice-depth/templates/new         admin create template
/modules/ice-depth/templates/[id]/edit   admin edit + publish template
```

Every route starts with `await requireModuleEnabled('ice_depth')`. Template routes additionally fail closed because the underlying RPCs require `has_module_access('ice_depth', 'admin')`.

## SQL RPCs

| RPC                                    | Purpose                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `rpc_save_ice_depth_template_draft`    | UPDATE `draft_points` / name / svg_key; AuthZ inside; no version bump   |
| `rpc_publish_ice_depth_template`       | Snapshot → swap → bump version → audit; rejects point-key-removal drops |
| `rpc_discard_ice_depth_template_draft` | Null out `draft_points`; idempotent                                     |
| `rpc_complete_ice_depth_session`       | Validate all template points recorded; flip status; audit               |

`recordReading` and `startSession` are TypeScript server actions (not RPCs) — upsert on `(session_id, point_key)` and INSERT with idempotency re-select respectively. No cross-row invariants require SQL atomicity.

## Bundled SVG backdrops

Three React components in `app/modules/ice-depth/svgs/`:

- `nhl.tsx` — 200 × 85 ft viewBox (NHL regulation)
- `olympic.tsx` — 200 × 100 ft viewBox (IIHF / Olympic)
- `studio.tsx` — 170 × 75 ft viewBox (practice / studio rink)

Each exports a `Component` and a `VIEWBOX` constant. The `RINK_SVGS` map in `index.ts` is the single point of extension: adding a new backdrop means adding a new component file + a new entry. `svg_key` CHECK constraint at the DB prevents inserting unknown keys.

Ideal replacement path: asset-swap to production-quality SVGs later. The contract is the component shape + viewBox; nothing else needs to change.

## Default point layout

Every new template ships with 8 default points (in `lib/ice-depth/template.ts::DEFAULT_POINTS`):

| key | label               | x_pct | y_pct |
| --- | ------------------- | ----- | ----- |
| p1  | Left goal crease    | 10    | 50    |
| p2  | Left zone — top     | 25    | 30    |
| p3  | Left zone — bottom  | 25    | 70    |
| p4  | Neutral — top       | 50    | 25    |
| p5  | Neutral — bottom    | 50    | 75    |
| p6  | Right zone — top    | 75    | 30    |
| p7  | Right zone — bottom | 75    | 70    |
| p8  | Right goal crease   | 90    | 50    |

Admins reposition / rename in the editor. Keys are snake_case and **must not** be reused across versions — the publish guard rejects drafts that drop a key referenced by historical readings.

## Mobile UX

Session-running UI at 390px:

- SVG fills most of the viewport. Each point is rendered with an invisible 6-unit-radius tap halo (≥44px at typical rendered sizes).
- Tap a point → full-screen `ReadingModal`. `inputMode="decimal"` triggers the numeric soft keyboard.
- Previous session's reading at that point is shown under the input for context.
- Two-finger pinch-zoom enabled via `touch-action: pan-x pan-y pinch-zoom`.
- Complete button is disabled until every template point has a reading. Upsert on the composite index means re-tapping a point replaces the previous value cleanly.

## Trend chart

Recharts `LineChart`. X-axis: session date. Y-axis: depth in mm. One line per `point_key`.

Version-change behavior:

- Point added in vN: its line starts at the first vN session.
- Point removed in vN: its line ends at the last session of the prior version.
- Point renamed (label, key stays): legend shows the **current label**; detail view still shows historical label via the template history snapshot (no `__label_snapshot` in Ice Depth — we read labels from `ice_depth_template_history.points` by pinned version).
- Threshold highlighter: user-entered threshold draws a dashed red reference line; below-threshold readings are not re-colored in v1 (visual highlight on a line chart would require custom dot rendering; deferred).

## Offline queue

Ice Depth doesn't directly integrate with Agent 7's form-engine offline queue (that's keyed on `submitForm`). Session actions (`startSession`, `recordReading`, `completeSession`) run against the DB at request time.

If the PWA is offline, the session-runner client will show server-action errors; Agent 7 can later add a per-action retry layer using the same `idempotency_key` concept (`startSession` already supports it). Explicitly deferred in v1.

## Known gaps / v2 backlog

- Drag-to-reposition points in the admin editor (v1 uses numeric inputs for x_pct / y_pct)
- `abandonSession` action wiring (schema has the enum; no UI invokes it)
- Hard-delete a template when no sessions reference it (v1: admins leave drafts cleared; no explicit delete)
- Threshold-based dot coloring on the trend chart (v1 only draws a reference line)
- Export readings (CSV / PDF)
- Historical reading annotations ("retake due to sensor glitch")

## Files shipped

**Migrations**
- `supabase/migrations/20260423000001_ice_depth_tables.sql`
- `supabase/migrations/20260423000002_ice_depth_fns.sql`

**TypeScript**
- `lib/ice-depth/types.ts`
- `lib/ice-depth/template.ts`
- `lib/ice-depth/session.ts`
- `app/modules/ice-depth/svgs/nhl.tsx`, `olympic.tsx`, `studio.tsx`, `index.ts`

**Components**
- `components/ice-depth/SvgRink.tsx`
- `components/ice-depth/SessionRunner.tsx`
- `components/ice-depth/ReadingModal.tsx`
- `components/ice-depth/TemplateEditor.tsx`
- `components/ice-depth/TrendChart.tsx`

**Routes** — under `app/modules/ice-depth/` (history, new, [id], [id]/run, trends, templates, templates/new, templates/[id]/edit)

**Tests**
- `supabase/tests/15_ice_depth.test.sql`

**Docs**
- `ICE_DEPTH.md` (this file)
