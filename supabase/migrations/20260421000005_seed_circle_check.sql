-- 20260421000005_seed_circle_check.sql
-- Seed Circle Check's default schema into module_default_schemas and backfill
-- form_schemas rows for every existing facility (so test facilities, and any real
-- facilities already created in Phase 1, get Circle Check working on day one).
--
-- Idempotent via ON CONFLICT.

-- 1. Default schema in module_default_schemas
insert into public.module_default_schemas
  (module_slug, form_type, default_schema_definition)
values (
  'ice_maintenance',
  'circle_check',
  $${
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
            "help_text": "Visual assessment of the sheet before inspection.",
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
            "label": "Estimated visual thickness (mm)",
            "required": false,
            "min": 20,
            "max": 80,
            "step": 1,
            "unit": "mm"
          }
        ]
      },
      {
        "key": "structural",
        "label": "Structural checks",
        "fields": [
          {
            "key": "glass_condition",
            "type": "select",
            "label": "Glass / dasher board condition",
            "required": true,
            "options": [
              { "key": "intact",        "label": "Intact" },
              { "key": "minor",         "label": "Minor damage" },
              { "key": "needs_repair",  "label": "Needs repair" }
            ]
          },
          {
            "key": "doors_clear",
            "type": "boolean",
            "label": "All exit doors clear and unlocked?",
            "required": true
          },
          {
            "key": "nets_intact",
            "type": "boolean",
            "label": "Goal nets intact?",
            "required": true
          }
        ]
      },
      {
        "key": "notes",
        "label": "Notes",
        "fields": [
          {
            "key": "summary",
            "type": "text",
            "label": "Summary",
            "required": false
          },
          {
            "key": "details",
            "type": "textarea",
            "label": "Additional notes",
            "required": false,
            "rows": 4
          }
        ]
      }
    ]
  }$$::jsonb
)
on conflict (module_slug, coalesce(form_type, '')) do update
  set default_schema_definition = excluded.default_schema_definition,
      updated_at = now();

-- 2. Backfill form_schemas for every existing non-platform facility
insert into public.form_schemas
  (facility_id, module_slug, form_type, schema_definition, version, is_published)
select
  f.id,
  'ice_maintenance',
  'circle_check',
  (select default_schema_definition from public.module_default_schemas
    where module_slug = 'ice_maintenance' and form_type = 'circle_check'),
  1,
  true
from public.facilities f
where f.is_platform = false
on conflict (facility_id, module_slug, form_type)
  where form_type is not null
  do nothing;
