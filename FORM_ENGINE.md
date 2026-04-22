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

## Submission table registry

`lib/forms/submission-tables.ts` maps `module_slug` → table + form_type flag.

Default: `${module_slug}_submissions`, no form_type column.

Override: add a line to `MODULE_TABLE_OVERRIDES` when the convention doesn't fit. Example entry for Ice Maintenance (already present):

```ts
ice_maintenance: { tableName: 'ice_maintenance_submissions', hasFormTypeColumn: true }
```

Custom-UI modules that don't use the engine (`ice_depth`, `scheduling`, `communications`, `admin_control_center`) throw from `getSubmissionTable` — they have their own server actions and should never call `submitForm`.

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

## Editor contract (Agent 6 consumes this — Phase 2)

Higher-level editor wrappers in `lib/forms/editor.ts` sit on top of `publish.ts` and are what Agent 6's admin UI actually calls. They add: admin-gating, key-immutability enforcement, and an annotated load shape.

- `loadFormSchemaForEditor({ moduleSlug, formType })` → `EditorLoadResult`. Returns the **unresolved** wire format for both `published` and `draft` (the editor renders `{ from_option_list: "…" }` as a reference, not as the resolved items — that's what the runtime render path does). The `annotations` struct carries:
  - `coreFieldKeys` — keys from the module's `core-fields.ts`. Editor renders their sections locked.
  - `protectedKeys` — union of every field key that has ever appeared in a published version (current + `form_schema_history`). Renames and removals against these keys are rejected.
  - `availableOptionListSlugs` — every slug from the caller's facility's `option_lists`. Feed the editor's autocomplete when admin picks `from_option_list`.
  - `availableResourceTypes` — hardcoded constant (`KNOWN_RESOURCE_TYPES`) today; graduates to DB-driven in Seam 2.
- `validateDraft({ draftDefinition, schemaId? })` → `EditorValidateResult`. Pure, no writes, no admin gate. Runs meta-schema; if `schemaId` provided, also runs key-immutability against that row's history. Agent 6 calls this as the admin types, to surface problems live.
- `saveDraft({ schemaId, draftDefinition })` → `EditorSaveResult`. Admin-gate + meta-schema + key-immutability + delegate to `saveFormSchemaDraft`.
- `publishDraft({ schemaId })` → `EditorPublishResult`. Admin-gate + re-validate draft + key-immutability vs. current + history + delegate to `publishFormSchema`.
- `discardDraft({ schemaId })` → `EditorDiscardResult`. Admin-gate + delegate to `discardFormSchemaDraft`.

### Key-immutability rule

A field key that has ever been in a published schema for a given `(facility_id, module_slug, form_type)` cannot be removed or renamed. Submissions reference `custom_fields` by key; dropping a key breaks historical detail rendering and strands submissions. To retire a field, mark it optional and hide it with `show_if`.

The check runs in TypeScript (in `editor.ts`, backed by `lib/forms/key-immutability.ts`). The RPC layer does not enforce it today — tracked as hardening follow-up in `KNOWN_GAPS.md`.

### Authorization

Every write action in `editor.ts` calls `has_module_access('admin_control_center', 'admin')` up-front. The underlying RPCs repeat the check. RLS is the outermost layer. This is the same gate pattern used by Communications' `admin-check.ts` — one admin role per facility, not per module.

### Integration pattern for Agent 6

Agent 6's admin editor UI is a client component. It cannot import from `lib/forms/editor.ts` directly (`'server-only'` marker trips). The wiring:

```ts
// app/admin/forms/[module]/[formType?]/actions.ts
'use server'

export {
  loadFormSchemaForEditor,
  validateDraft,
  saveDraft,
  publishDraft,
  discardDraft,
} from '@/lib/forms/editor'
```

Import those from a client component via `'use server'` boundary. Nothing in `lib/forms/editor.ts` needs to change per-module or per-route; one shim file in Agent 6's admin route is enough.

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

## Option lists admin (Agent 6 consumes — Phase 2 Seam 2)

Admin UI for editing shared dropdown option sources lives at `/admin/option-lists` and calls server actions from `app/admin/option-lists/actions.ts`, which wrap `lib/admin/option-lists.ts`.

### Server actions

Lists:

- `createOptionList({ slug, name, description? })` — slug format `^[a-z][a-z0-9_]*$`, name required. Audits `option_list.created`.
- `updateOptionList(id, { name?, description? })` — slug is immutable. Audits `option_list.updated`.
- `deleteOptionList(id)` — refuses if any **published** form schema still references the slug. Returns `references[]` when blocked. Drafts do not block deletion. Audits `option_list.deleted`.

Items:

- `addOptionListItem({ option_list_id, key, label, sort_order? })` — key format `^[a-z0-9][a-z0-9_]*$`, label required, `is_active: true` on create. Audits `option_list_item.created`.
  - Alias `createOptionListItem` kept for Phase 1 caller compatibility.
- `renameOptionListItemLabel(id, newLabel)` — changes label only. Previous label captured in audit metadata for a visible diff. Audits `option_list_item.label_renamed`.
- `deactivateOptionListItem(id)` — sets `is_active: false`. The item disappears from new form renders (resolver filters on `is_active`); historical submissions keep their value via `custom_fields.__label_snapshot`. Audits `option_list_item.deactivated`.
- `reactivateOptionListItem(id)` — sets `is_active: true`. Audits `option_list_item.reactivated`.
- `reorderOptionListItems(option_list_id, orderedItemIds)` — sets `sort_order` to the position of each id in the array. Non-atomic across rows (no RPC today); a mid-update failure leaves a recoverable mixed state. Audits `option_list_items.reordered` once per intent, metadata includes the full ordered id list.
- `updateOptionListItem(id, { label?, sort_order?, is_active? })` — generic patch for Phase 1 callers. New callers should prefer the semantic wrappers above so audit entries carry clear intent.

### Stability invariants (exercised by `tests/integration/form-engine/option-list-stability.test.ts`)

1. **Key is immutable.** `option_list_items.key` has a DB trigger (`tg_option_list_items_key_immutable`) that rejects any UPDATE that changes `key`, including with service-role credentials. To retire an option, deactivate it; to introduce a new name for the same concept, add a new item with a new key.
2. **Label rename is cosmetic.** Submissions store the key, not the label. A rename changes what new renders and new submissions see; it does not alter historical rows.
3. **Deactivation is render-layer only.** `lib/forms/resolve-options.ts` filters by `is_active = true`. The item and its historical references persist in the DB.
4. **Delete-safety is slug-based.** `deleteOptionList` scans `form_schemas.schema_definition` (not drafts) for `from_option_list: "<slug>"` references. Published references block the delete; stale drafts do not.

### Authorization

Every mutation in `lib/admin/option-lists.ts` calls `has_module_access('admin_control_center', 'admin')` up-front. RLS on `option_lists` and `option_list_items` (from migration `20260421000001_option_lists.sql`) enforces the same at the DB boundary. Platform admins pass both checks.

### Audit

Every mutation writes to `audit_log` before returning `{ ok: true }`. Audit write failures propagate to the caller — we deliberately do not swallow them, because an untracked admin mutation is exactly what the table exists to catch.

## Not your concern

- **Rendering the admin editor** — Agent 6's scope. You just author the meta-schema and the core-fields.ts file; the editor uses them.
- **Offline queue implementation** — Agent 7's scope. You just emit submissions with idempotency keys.
- **Stripe gating** — Agent 7 wraps every write-path server action. Nothing for you to do.
- **PWA, deployment, notifications** — Agent 7.
- **Analytics / tracing** — Agent 7 instruments at the server-action layer.
