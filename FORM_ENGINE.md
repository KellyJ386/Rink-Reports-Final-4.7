# FORM_ENGINE.md

How to build a schema-driven module on top of Agent 2's form engine. Written so Agent 3 (module factory) and Agent 4 (Ice Depth, which shares patterns but not the engine) can follow blind.

**Read `FOUNDATION.md` and `FORM_SCHEMA_FORMAT.md` first.** This doc assumes you understand the tenancy model and the schema DSL.

---

## Universal route convention

Every module — yours and everyone else's — lives at:

```
/modules/<module-slug>/...
```

No exceptions. If your plan puts a module anywhere else, re-read this line.

For Ice Maintenance specifically:

- `/modules/ice-maintenance/` — shell (tabs to four form types in Agent 3; currently lists Circle Check only)
- `/modules/ice-maintenance/circle-check/` — history
- `/modules/ice-maintenance/circle-check/new` — file a new one
- `/modules/ice-maintenance/circle-check/[id]` — detail

Single-form modules use the shorter layout:

- `/modules/<slug>/` — history
- `/modules/<slug>/new`
- `/modules/<slug>/[id]`

## Submission table contract

Every submission table created by any agent **must** include:

| Column                | Type         | Notes                                                                     |
| --------------------- | ------------ | ------------------------------------------------------------------------- |
| `id`                  | uuid         | `gen_random_uuid()` default                                               |
| `facility_id`         | uuid         | `default current_facility_id()`; FK to `facilities`                       |
| `submitted_by`        | uuid         | FK to `users`                                                             |
| `submitted_at`        | timestamptz  | `default now()`                                                           |
| `form_schema_version` | int          | **Required**; pinned at insert so FormDetail renders against history      |
| `custom_fields`       | jsonb        | Default `'{}'::jsonb`; holds non-core fields per the current schema       |
| `idempotency_key`     | text         | Nullable; partial unique on `(facility_id, idempotency_key) WHERE NOT NULL` |
| `<core columns>`      | varies       | One column per `coreFieldsDbColumns` entry                                |

Plus the four RLS policies per `FOUNDATION.md`'s recipe.

**Idempotency index** is non-negotiable:

```sql
create unique index if not exists <table>_idempotency_key
  on public.<table> (facility_id, idempotency_key)
  where idempotency_key is not null;
```

The engine uses this to implement retry-safe writes for offline submission replay.

## Core field registry

Each module ships a core-fields file at one of these paths:

```
app/modules/<module-slug>/core-fields.ts                   # single-form modules
app/modules/<module-slug>/<form-type>/core-fields.ts       # multi-form modules (Ice Maintenance only)
```

The file must export exactly three symbols:

```ts
import { z } from 'zod'
import type { SectionSpec } from '@/lib/forms/types'

export const coreFieldsZodSchema = z.object({ /* … */ })
export const coreFieldsRenderSpec: SectionSpec[] = [ /* … */ ]
export const coreFieldsDbColumns: string[] = [ /* column names on the submission table */ ]
```

The engine dynamically imports this file based on `(module_slug, form_type)` at render + submit time.

- `coreFieldsZodSchema` validates the core portion of the submission payload.
- `coreFieldsRenderSpec` renders alongside custom fields; admin editor marks it locked.
- `coreFieldsDbColumns` tells the submit path which keys go to columns vs. `custom_fields` jsonb.

**You do not need to add the same fields twice** — core-fields are columns on the submission table AND appear in the render spec. The engine splits them up at submit time.

### Example — Circle Check

```ts
// app/modules/ice-maintenance/circle-check/core-fields.ts
export const coreFieldsZodSchema = z.object({
  surface_resource_id: z.string().uuid({ message: 'Surface is required' }),
})

export const coreFieldsRenderSpec: SectionSpec[] = [{
  key: 'which_surface',
  label: 'Surface',
  fields: [{
    key: 'surface_resource_id',
    type: 'select',
    label: 'Which ice surface?',
    required: true,
    options: { from_resource_type: 'surface' },
  }],
}]

export const coreFieldsDbColumns: string[] = ['surface_resource_id']
```

## Submission module registry — Phase 2 Seam 3

`app/modules/_registry.ts` is the single source of truth for every form-engine module. Every module that uses `submitForm` must be listed here with its slug, its form types (or `null`), its submission table, and the on-disk path to each `core-fields.ts`.

```ts
{
  slug: 'ice_maintenance',                          // matches modules.slug in the DB
  submissionTable: 'ice_maintenance_submissions',   // the row's target table
  hasFormTypeColumn: true,                          // one table, many form types
  forms: [
    { formType: 'circle_check', coreFieldsPath: 'app/modules/ice-maintenance/circle-check/core-fields.ts' },
    // …
  ],
}
```

Why explicit paths, not derived from slug: module DB slugs are snake_case (`ice_maintenance`, `air_quality`) while the on-disk directories are kebab-case (`ice-maintenance/`, `air-quality/`). Encoding the path removes a translation rule and makes the registry the authoritative map.

### Drift protection

Two self-tests enforce the registry:

1. **`tests/unit/modules/registry-filesystem.test.ts`** (blocking, runs in unit job). For each registered entry, asserts the `coreFieldsPath` exists and exports the three required symbols. Also checks that every `core-fields.ts` on disk is registered — orphans fail the build. Slug and form-type invariants (snake_case, uniqueness, `hasFormTypeColumn` consistency) are asserted too.
2. **`tests/integration/modules/registry-db.test.ts`** (runs in integration job; currently `continue-on-error` until fixture graduation). Asserts every `(slug, form_type)` has a `module_default_schemas` row and every submission table has the standard columns + idempotency partial unique index.

When Agent 3 or Agent 4 ships a new module: the registry entry, the `core-fields.ts` file, the migration seeding `module_default_schemas`, and the submission table migration all land in the same PR, or the blocking filesystem test fails.

### Escape hatch

For mid-flight refactors where drift is intentionally visible to CI, the workflow doc (`docs/agent-workflow.md`) defines a `Registry-Drift-Acknowledged: <reason>` token that the reviewer can grep for in the PR body. The filesystem test itself always runs and reports; acknowledgement is a human-review signal, not a CI bypass. Use sparingly.

### Accessor API

Callers use `lib/forms/module-registry.ts`:

- `getRegistryEntry(slug)` — full entry or null.
- `getRegistryForm(slug, formType)` — the specific `(slug, formType)` form spec or null.
- `getSubmissionTable(slug)` — returns `{ tableName, hasFormTypeColumn }`. Throws on unknown or custom-UI slugs with clear messages. Replaces the Phase 1 function in `lib/forms/submission-tables.ts` (which now re-exports from here for backwards compat).
- `listAllRegisteredForms()` — flat array of every `(slug, formType)` the engine knows about.

Custom-UI modules (`ice_depth`, `scheduling`, `communications`, `admin_control_center`) live in `CUSTOM_UI_MODULE_SLUGS` in the registry file. `getSubmissionTable` throws a clear error if called with one of their slugs — those modules do their own server actions and should never hit `submitForm`.

## Submit flow

Your module's `new/page.tsx` calls a server action that wraps `submitForm`:

```ts
'use server'
import { submitForm, type SubmitFormResult } from '@/lib/forms/submit'

export async function submitMyForm(
  values: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<SubmitFormResult> {
  return submitForm({
    moduleSlug: 'my_module',
    formType: null,           // or 'specific_form_type' for multi-form tables
    values,
    idempotencyKey,
  })
}
```

`submitForm`:

1. Loads the current `form_schema` via RLS.
2. Loads your `core-fields.ts` via dynamic import.
3. Builds a combined Zod (your `coreFieldsZodSchema` + meta-schema-derived Zod for custom fields).
4. Validates.
5. Snapshots selected option labels into `custom_fields.__label_snapshot`.
6. Partitions values into `<core_columns>` vs. `custom_fields`.
7. Inserts with idempotency: same key → same row (returns `idempotentReturn: true`).
8. Writes `audit_log`.

Errors return `{ ok: false, error, fieldErrors }` mapped to field paths — suitable for surfacing under each field in your form.

## Rendering the form

```tsx
// new/page.tsx (Server Component)
import { loadPublishedFormSchema } from '@/lib/forms/load-form-schema'
import { NewMyFormClient } from './client'

export default async function NewMyFormPage() {
  const loaded = await loadPublishedFormSchema('my_module', null)
  if (!loaded) return <p>Schema not configured.</p>
  return <NewMyFormClient sections={loaded.schema.sections} />
}
```

```tsx
// new/client.tsx (Client Component)
'use client'
import { DynamicForm } from '@/components/dynamic-form/DynamicForm'
import { submitMyForm } from './actions'

export function NewMyFormClient({ sections }) {
  const idempotencyKey = useMemo(() => crypto.randomUUID(), [])
  return (
    <DynamicForm
      sections={sections}
      submitLabel="Submit"
      onSubmit={(values) => submitMyForm(values, idempotencyKey)}
    />
  )
}
```

The `useMemo(…, [])` fixes the idempotency key for the lifetime of the page so double-submits are deduplicated server-side.

## History view

```tsx
// page.tsx (Server Component)
import { FormHistory, type FormHistoryColumn } from '@/components/form-history/FormHistory'

const COLUMNS: FormHistoryColumn[] = [
  { key: 'submitted_at', label: 'Submitted', source: 'submitted_at', format: 'datetime' },
  { key: 'severity',     label: 'Severity',  source: 'custom.severity', format: 'label-snapshot' },
]

export default function MyModuleHistoryPage() {
  return (
    <FormHistory
      moduleSlug="my_module"
      formType={null}
      baseUrl="/modules/my-module"
      columns={COLUMNS}
    />
  )
}
```

Column `source` values:
- A plain column name (e.g. `submitted_at`): reads the submission-table column.
- `custom.<key>`: reads `custom_fields[<key>]`. Pair with `format: 'label-snapshot'` to read the snapshotted label instead of the raw key.

## Detail view

```tsx
// [id]/page.tsx
import { FormDetail } from '@/components/form-detail/FormDetail'

export default async function MyDetail({ params }) {
  const { id } = await params
  return <FormDetail moduleSlug="my_module" formType={null} submissionId={id} />
}
```

`FormDetail` reads the submission's `form_schema_version` and loads the schema from `form_schema_history`. Labels use the stored snapshot; renames don't rewrite history.

## Offline submission hook (Agent 7 consumes)

The engine defines the queued shape at `lib/forms/types.ts`:

```ts
export type QueuedSubmission = {
  id: string          // client uuid = idempotency_key
  module_slug: string
  form_type: string | null
  payload: Record<string, unknown>
  created_at: string
  attempts: number
  last_error?: string
  status: 'queued' | 'in_flight' | 'synced' | 'failed'
}
```

Agent 7's service worker reads this queue, calls `submitForm` with the same `idempotencyKey`, and relies on the partial unique index to dedupe on replay. No module-specific integration needed.

## Publish / discard a schema change (admin flow — consumed by Agent 6)

Server actions live in `lib/forms/publish.ts`:

- `saveFormSchemaDraft(form_schema_id, jsonb)` — validates the draft against the meta-schema and writes `draft_definition`.
- `publishFormSchema(form_schema_id)` — snapshots current → history, swaps draft → current, bumps version, audits. All atomic inside `rpc_publish_form_schema`.
- `discardFormSchemaDraft(form_schema_id)` — clears `draft_definition`.

Agent 6's admin editor UI wraps these; no other agent invokes them directly.

## New-module checklist (Agent 3 / Agent 4)

1. Create the submission table with the standard columns above + your module's core columns + RLS policies.
2. Author `app/modules/<slug>/<form-type?>/core-fields.ts` with the three required exports.
3. Seed a default schema into `module_default_schemas` in a new migration.
4. Backfill `form_schemas` for existing facilities in the same migration (`INSERT … FROM facilities … ON CONFLICT DO NOTHING`).
5. If your table needs an override (multi-form discriminator, renamed table), add it to `MODULE_TABLE_OVERRIDES` in `lib/forms/submission-tables.ts`.
6. Route files:
   - `app/modules/<slug>/[<form-type>/]page.tsx` — history
   - `app/modules/<slug>/[<form-type>/]new/page.tsx` + `client.tsx` + `actions.ts` — file
   - `app/modules/<slug>/[<form-type>/][id]/page.tsx` — detail
7. pgTAP tests for: RLS isolation, idempotency, form_type constraint (if present), module access gating.

If a convention on this page doesn't fit your module, **stop and ask**. Deviations are the agent-model's biggest risk.

## Not your concern

- **Rendering the admin editor** — Agent 6's scope. You just author the meta-schema and the core-fields.ts file; the editor uses them.
- **Offline queue implementation** — Agent 7's scope. You just emit submissions with idempotency keys.
- **Stripe gating** — Agent 7 wraps every write-path server action. Nothing for you to do.
- **PWA, deployment, notifications** — Agent 7.
- **Analytics / tracing** — Agent 7 instruments at the server-action layer.
