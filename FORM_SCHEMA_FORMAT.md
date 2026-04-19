# FORM_SCHEMA_FORMAT.md

The form schema DSL. Shipped by Agent 2. Every schema-driven module reads this format; Agent 6's admin editor produces it.

Every document carries `$schema: "rink-form-schema/v1"`. Future breaking changes bump the version; the engine refuses to render any schema it doesn't understand.

Runtime validator lives in `lib/forms/meta-schema.ts` — edit together with this doc.

---

## Top-level shape

```json
{
  "$schema": "rink-form-schema/v1",
  "sections": [ /* one or more SectionSpec */ ]
}
```

## SectionSpec

```json
{
  "key": "snake_case_unique_within_schema",
  "label": "Human-readable header shown in the form",
  "fields": [ /* one or more FieldSpec */ ]
}
```

## FieldSpec — shared keys (every type)

| Key         | Required | Notes                                                                         |
| ----------- | -------- | ----------------------------------------------------------------------------- |
| `key`       | ✓        | snake_case, starts with a letter, unique across the whole schema              |
| `type`      | ✓        | One of the types below                                                        |
| `label`     | ✓        | Rendered to users                                                             |
| `help_text` |          | Short hint under the label                                                    |
| `required`  |          | Defaults to `false`. Hidden-by-`show_if` fields are not required regardless.  |
| `show_if`   |          | Conditional visibility; must reference a field defined earlier in the schema  |

### `show_if` shapes

Exactly one of `equals`, `not_equals`, or `in` is required:

```json
{ "field": "weather_noted", "equals": true }
{ "field": "status",         "not_equals": "draft" }
{ "field": "priority",       "in": ["high", "urgent"] }
```

A hidden field is **not required** by the validator even if its `required: true`. When the condition later becomes true, required-ness re-applies.

## Field types

### `text`, `textarea`

- `textarea` accepts `rows` (1–20, default 4).
- No per-type options.

### `number`

- Optional `min`, `max`, `step`, `unit`.
- Client uses `inputMode="decimal"` so mobile shows the numeric keyboard.

### `boolean`

- Rendered as a checkbox. `required: true` means the user must tick it (rare; prefer a radio with yes/no labels if "must choose" matters).

### `select`, `multiselect`, `radio`

- Accept `options`: either an inline array, a `from_option_list` reference, or a `from_resource_type` reference (see below).

### `date`, `time`, `datetime`

- Use the native `<input type="...">` on the field. No additional options.

### `slider`

- `min`, `max` required; `step` defaults to 1; `unit` optional.
- Rendered as `<input type="range">` with numeric readout.

## Option sources

`select`, `multiselect`, and `radio` fields accept one of three option sources.

### 1) Inline array

```json
"options": [
  { "key": "low",  "label": "Low" },
  { "key": "high", "label": "High" }
]
```

`key` is snake_case and **immutable** once a submission references it (stored as the submitted value). `label` is the display text; admins edit freely.

### 2) `from_option_list`

```json
"options": { "from_option_list": "hazards" }
```

Resolves to the active items of the facility's `option_list` with `slug = "hazards"`. Stable `key` is enforced by a DB trigger on `option_list_items` — renaming a key is rejected, so submissions never lose their reference.

Facility admins manage option lists at `/admin/option-lists` (Agent 6).

### 3) `from_resource_type`

```json
"options": { "from_resource_type": "surface" }
```

Resolves to the facility's active `facility_resources` rows with the given `resource_type`. `key` is the resource UUID; `label` is `name`. Renaming a resource never rewrites history because submissions store the UUID.

Current well-known resource types (maintained in `facility_resources.resource_type`):

- `surface` — ice sheets
- `compressor` — refrigeration compressors
- `zamboni` — ice resurfacers
- `air_quality_device` — CO/NO₂/particulate sensors
- `shift_position` — scheduling positions

## Label snapshotting

When a user submits a form, the engine records **both** the selected `key` and the current `label` in `custom_fields.__label_snapshot`. Historical detail views read snapshots first, so a label renamed in 2027 still shows its 2026 text on a 2026 submission.

Multiselect snapshots are arrays of labels in selection order.

## Validation — the meta-schema

Every publish runs the draft through `FormSchemaDefinitionDoc` in `lib/forms/meta-schema.ts`. It rejects:

- Missing or malformed `key`, `label`, `type`
- Duplicate `key` across the whole schema (even across sections)
- `show_if` referencing a field defined later in the schema
- Unknown `type`
- Option sources that are neither inline arrays nor `{ from_option_list }` nor `{ from_resource_type }`

The editor in `/admin/forms/[module]/[form_type]` (Agent 6) runs the same validator client-side for instant feedback.

## Complete example — Circle Check default

See `supabase/migrations/20260421000005_seed_circle_check.sql` for the canonical Circle Check default schema, which exercises `radio`, `slider`, `select` (inline), `boolean`, `text`, and `textarea`.

```json
{
  "$schema": "rink-form-schema/v1",
  "sections": [
    {
      "key": "ice_assessment",
      "label": "Ice assessment",
      "fields": [
        {
          "key": "ice_condition",
          "type": "radio",
          "label": "Ice surface condition",
          "required": true,
          "options": [
            { "key": "excellent", "label": "Excellent" },
            { "key": "good",      "label": "Good" },
            { "key": "fair",      "label": "Fair" },
            { "key": "poor",      "label": "Poor" }
          ]
        },
        {
          "key": "visual_thickness_mm",
          "type": "slider",
          "label": "Estimated visual thickness",
          "min": 20, "max": 80, "step": 1, "unit": "mm"
        }
      ]
    }
  ]
}
```

## Core fields vs. custom fields

Core fields come from `app/modules/<module>/<form_type?>/core-fields.ts`. They appear in the render alongside custom fields but are **locked** — admins see them in the editor but cannot rename, reorder, or remove. See `FORM_ENGINE.md` for the registry contract.

## Versioning rules

- `version` is a monotonic int on `form_schemas`.
- Every submission pins its `form_schema_version`. Detail views read that version from `form_schema_history` (or, for the current version, from `form_schemas` directly).
- **Never** re-index by an admin-visible identifier other than the integer version. The combination `(facility_id, module_slug, form_type, version)` uniquely identifies a schema snapshot.

## What's not supported (v1)

- Nested sections / groups (one level of sections only)
- Repeated-row fields ("add another" tables)
- File uploads of any kind (no photo storage per product policy)
- Cross-facility template sharing
- HTML or markdown in labels (text only; render escapes everything)

If you need something not in the format, **stop and ask**. The meta-schema is the contract; extending it touches every module.
