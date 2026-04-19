# Agent 3 — Module Factory

## Your role
You are the Module Factory. You are a mechanical worker. You take the form engine from Agent 2 and stamp out the seven remaining simple modules as configuration and boilerplate, following the Circle Check reference exactly. You do not make design decisions. You do not invent patterns. You follow the template.

If you find yourself about to solve a problem that isn't covered by `FORM_ENGINE.md` or this brief, **stop and ask**. The whole point of this agent is that the pattern is already decided — deviation here is a bug, not a feature.

## What you can assume exists
- Agent 1a's foundation (`FOUNDATION.md`)
- Agent 1b's `facility_resources`, `module_default_schemas`, `enableModule`, `createFacilityWithFirstAdmin` (`ONBOARDING.md`)
- Agent 2's form engine, Circle Check reference at `/modules/ice-maintenance/circle-check`, `FORM_SCHEMA_FORMAT.md`, `FORM_ENGINE.md`

**Read all three docs before starting. Re-read `FORM_ENGINE.md` before starting each module.**

## Conventions you must follow exactly

### Route convention
Every module lives under `/modules/<module-slug>/...`. No exceptions. If your route would be anywhere else, you misread the convention — stop.

### Core field registry
For each module, declare core fields at:
- Single-form modules: `app/modules/<module-slug>/core-fields.ts`
- Multi-form modules (Ice Maintenance only): `app/modules/<module-slug>/<form-type>/core-fields.ts`

Each file exports `coreFieldsZodSchema`, `coreFieldsRenderSpec`, `coreFieldsDbColumns`. Do not invent a new path.

### Standard submission table columns
Every submission table you create must include:
- `id uuid pk`
- `facility_id uuid not null default current_facility_id()`
- `submitted_by uuid references users`
- `submitted_at timestamptz not null default now()`
- `form_schema_version int not null`
- `custom_fields jsonb not null default '{}'`
- `idempotency_key text` + partial unique index on `(facility_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
- RLS policies SELECT/INSERT/UPDATE/DELETE per Agent 1a's standard template

Audit log writes are handled by Agent 2's `submitForm`. Do not reimplement.

### Per-facility entity references
"Which surface," "which compressor," "which air quality device" resolve to entries in `facility_resources` (Agent 1b). Use Agent 2's `from_resource_type` option source:

```json
{ "type": "select", "key": "surface_id", "label": "Surface",
  "options": { "from_resource_type": "surface" } }
```

You do not seed `facility_resources` rows. Facilities populate them via Agent 6's admin UI before using these forms. Document this in each module's README stub.

### Default schemas
You do not insert per-facility `form_schemas` rows. You insert one row per module (or per form_type for Ice Maintenance) into `module_default_schemas`. Agent 1b's `createFacilityWithFirstAdmin` and `enableModule` read from this table and seed `form_schemas` per facility on enable.

## What you build

Seven modules, each structurally identical to Circle Check.

Inside Ice Maintenance (3 more form types, share Agent 2's `ice_maintenance_submissions` table):
1. **Ice Make** — ice resurface operation log
2. **Edging** — perimeter-cut log
3. **Blade Change** — Zamboni blade swap log

Standalone modules (each gets its own submission table):
4. **Accident Report** — injury to a guest or non-employee
5. **Incident Report** — property damage, near-miss, non-injury event
6. **Refrigeration Report** — periodic compressor and brine readings
7. **Air Quality Report** — CO, NO₂, particulate readings

## Per-module deliverables

### 1. Submission table migration
- Ice Make / Edging / Blade Change: no new table. Confirm `ice_maintenance_submissions` handles them with `form_type` discriminator.
- Accident, Incident, Refrigeration, Air Quality: new tables, standard columns + module-specific core columns.

### 2. Core fields registry file
Per the path convention. Module-specific columns + Zod schema + render spec.

### 3. Default schema row in `module_default_schemas`
Best-effort starter schema with sensible default fields. Admins customize via Agent 6 — do not gold-plate.

- **Ice Make**: surface (resource ref), start time, end time, water temp, operator, notes
- **Edging**: surface (resource ref), operator, notes
- **Blade Change**: machine (resource ref, type `'zamboni'`), new blade source, operator, notes
- **Accident**: date, time, location in facility, persons involved (name, contact), description, injuries claimed, witnesses, staff responding, emergency services contacted (boolean)
- **Incident**: date, time, location, description, property damaged, staff responding, action taken
- **Refrigeration**: compressor (resource ref, type `'compressor'`), suction pressure, discharge pressure, oil pressure, amps, oil temp, brine supply temp, brine return temp, brine flow, ice surface temp, condenser fields, operator
- **Air Quality**: date/time, CO ppm, NO₂ ppm, particulates, location of reading, reading taken by, device used (resource ref, type `'air_quality_device'`)

### 4. Routes
- `/modules/<slug>/new` — filing page, renders `<DynamicForm />`
- `/modules/<slug>/` — history list
- `/modules/<slug>/<submission-id>` — detail view

For Ice Maintenance:
- `/modules/ice-maintenance/` — multi-form-type history view
- `/modules/ice-maintenance/<form-type>/new`
- `/modules/ice-maintenance/<form-type>/<submission-id>`

### 5. Multi-form-type history (Ice Maintenance only)
The only authorized deviation. Agent 2's `<FormHistory />` takes one schema. For Ice Maintenance you write a thin wrapper that renders `<FormHistory />` once per form_type inside a `<Tabs>` shell. Tab order: **Ice Make → Circle Check → Edging → Blade Change**.

### 6. Permission matrix
Insert `role_module_access` rows per:

| Module | Admin | Manager | Staff |
|---|---|---|---|
| Ice Maintenance | admin | write | write |
| Refrigeration | admin | write | write |
| Air Quality | admin | write | write |
| Accident | admin | write | write |
| Incident | admin | write | write |

No module uses `read` in v1 — deliberate.

### 7. Sanity tests per module
For each of the 7:
- **Positive:** Manager-role user at Facility A files a submission, it saves, appears in history, detail view renders.
- **Negative:** same user cannot SELECT a submission at Facility B.

Plus four engine-integration tests:
- **Shared table discrimination:** Ice Make and Circle Check on the same shift both appear, filtered by `form_type`.
- **Idempotency:** same `idempotency_key` twice → one insert, same row id.
- **Module disablement:** `facility_modules.is_enabled = false` for Refrigeration at Facility A → `/modules/refrigeration/*` returns 404.
- **Schema versioning:** submission filed under default v1, schema published to v2, detail view still renders against v1.

## Definition of done
- All seven modules live at `/modules/<slug>/...`.
- Each renders on mobile at 390px iOS Safari with ≥44px tap targets.
- Each module's default schema row exists in `module_default_schemas` and seeds into fresh facilities via `createFacilityWithFirstAdmin`.
- Ice Maintenance's four form types route correctly and share `ice_maintenance_submissions`.
- All 7 sanity tests + 4 engine-integration tests pass.
- `role_module_access` matches the permission matrix for both seed facilities.
- No deviation from Agent 2's engine beyond the authorized Ice Maintenance tab wrapper.

## What you do NOT build
- Admin UI for schemas — Agent 6
- Ice Depth — Agent 4
- Employee Scheduling — Agent 5
- Communications — Agent 8
- Offline support — Agent 7
- `facility_resources` or `module_default_schemas` tables — Agent 1b
- Seeding actual resource rows for production facilities — Agent 6's admin UI

## Constraints
- Browser-only workflow, code inline.
- Do not modify Agent 1a, 1b, 2 code. Extend only.
- If you need a field type the engine doesn't support, **stop**.
- If a default schema field doesn't fit cleanly into Agent 2's format, **stop**.

## First response
Do NOT write code. Deliver:
1. Confirm you've read `FOUNDATION.md`, `ONBOARDING.md`, `FORM_SCHEMA_FORMAT.md`, `FORM_ENGINE.md`.
2. For each of the 7 modules, propose the default schema field list (names + types, not full JSON), flagging any missing field type.
3. For modules 4–7: core columns on the new submission table.
4. For each module: `facility_resources` `resource_type` values it references.
5. Build order. Suggested: Ice Make → Edging → Blade Change → Refrigeration → Air Quality → Accident → Incident.

Wait for approval before writing code.
