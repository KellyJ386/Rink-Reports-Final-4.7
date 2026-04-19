-- 20260422000002_seed_module_defaults.sql
-- Seed module_default_schemas for 7 new form types/modules and backfill form_schemas
-- for every existing non-platform facility so they work day one.
--
-- Idempotent via ON CONFLICT.
--
-- Seeded:
--   ice_maintenance:ice_make
--   ice_maintenance:edging
--   ice_maintenance:blade_change
--   refrigeration (null form_type)
--   air_quality   (null form_type)
--   accident      (null form_type)
--   incident      (null form_type)

-- ============================================================================
-- 1. module_default_schemas
-- ============================================================================

-- Ice Make (form_type=ice_make)
insert into public.module_default_schemas (module_slug, form_type, default_schema_definition)
values (
  'ice_maintenance',
  'ice_make',
  $${
    "$schema": "rink-form-schema/v1",
    "sections": [
      {
        "key": "resurface_details",
        "label": "Resurface details",
        "fields": [
          {
            "key": "observed_condition",
            "type": "radio",
            "label": "Ice condition before resurface",
            "required": true,
            "options": [
              { "key": "excellent", "label": "Excellent" },
              { "key": "good",      "label": "Good" },
              { "key": "fair",      "label": "Fair" },
              { "key": "poor",      "label": "Poor" }
            ]
          },
          {
            "key": "lap_count",
            "type": "number",
            "label": "Lap count",
            "required": false,
            "min": 1,
            "max": 20,
            "step": 1
          },
          {
            "key": "cut_depth_pass",
            "type": "select",
            "label": "Pass type",
            "required": false,
            "options": [
              { "key": "full_flood", "label": "Full flood" },
              { "key": "dry_cut",    "label": "Dry cut" },
              { "key": "wet_cut",    "label": "Wet cut" },
              { "key": "edge_cut",   "label": "Edge cut" }
            ]
          },
          {
            "key": "ice_surface_temp_f",
            "type": "number",
            "label": "Ice surface temperature",
            "required": false,
            "min": -20,
            "max": 40,
            "step": 0.1,
            "unit": "°F"
          }
        ]
      },
      {
        "key": "notes",
        "label": "Notes",
        "fields": [
          {
            "key": "water_quality_notes",
            "type": "textarea",
            "label": "Water quality notes",
            "required": false,
            "rows": 3
          }
        ]
      }
    ]
  }$$::jsonb
)
on conflict (module_slug, coalesce(form_type, '')) do update
  set default_schema_definition = excluded.default_schema_definition,
      updated_at = now();

-- Edging (form_type=edging)
insert into public.module_default_schemas (module_slug, form_type, default_schema_definition)
values (
  'ice_maintenance',
  'edging',
  $${
    "$schema": "rink-form-schema/v1",
    "sections": [
      {
        "key": "edging_details",
        "label": "Edging details",
        "fields": [
          {
            "key": "edger_used",
            "type": "select",
            "label": "Edger / resurfacer used",
            "required": false,
            "options": { "from_resource_type": "zamboni" }
          },
          {
            "key": "edge_width_in",
            "type": "number",
            "label": "Edge width",
            "required": false,
            "min": 0.5,
            "max": 4,
            "step": 0.25,
            "unit": "inches"
          },
          {
            "key": "started_at",
            "type": "time",
            "label": "Started at",
            "required": false
          },
          {
            "key": "ended_at",
            "type": "time",
            "label": "Ended at",
            "required": false
          },
          {
            "key": "perimeter_complete",
            "type": "boolean",
            "label": "Full perimeter completed?",
            "required": false
          }
        ]
      },
      {
        "key": "notes",
        "label": "Notes",
        "fields": [
          {
            "key": "coverage_notes",
            "type": "textarea",
            "label": "Coverage notes",
            "required": false,
            "rows": 3
          }
        ]
      }
    ]
  }$$::jsonb
)
on conflict (module_slug, coalesce(form_type, '')) do update
  set default_schema_definition = excluded.default_schema_definition,
      updated_at = now();

-- Blade Change (form_type=blade_change)
insert into public.module_default_schemas (module_slug, form_type, default_schema_definition)
values (
  'ice_maintenance',
  'blade_change',
  $${
    "$schema": "rink-form-schema/v1",
    "sections": [
      {
        "key": "blade_details",
        "label": "Blade details",
        "fields": [
          {
            "key": "old_blade_condition",
            "type": "radio",
            "label": "Old blade condition",
            "required": true,
            "options": [
              { "key": "sharp",     "label": "Sharp / retiring early" },
              { "key": "dull",      "label": "Dull" },
              { "key": "damaged",   "label": "Damaged" },
              { "key": "scheduled", "label": "Scheduled replacement" }
            ]
          },
          {
            "key": "new_blade_source",
            "type": "select",
            "label": "New blade source",
            "required": true,
            "options": [
              { "key": "factory_new",  "label": "Factory new" },
              { "key": "resharpened",  "label": "Resharpened" },
              { "key": "warranty",     "label": "Warranty replacement" },
              { "key": "other",        "label": "Other" }
            ]
          },
          {
            "key": "mileage_on_old_blade_hours",
            "type": "number",
            "label": "Hours on old blade",
            "required": false,
            "min": 0,
            "max": 1000,
            "step": 1,
            "unit": "hrs"
          },
          {
            "key": "sharpening_vendor",
            "type": "text",
            "label": "Sharpening vendor",
            "required": false,
            "show_if": { "field": "new_blade_source", "equals": "resharpened" }
          }
        ]
      },
      {
        "key": "notes",
        "label": "Notes",
        "fields": [
          {
            "key": "notes",
            "type": "textarea",
            "label": "Additional notes",
            "required": false,
            "rows": 3
          }
        ]
      }
    ]
  }$$::jsonb
)
on conflict (module_slug, coalesce(form_type, '')) do update
  set default_schema_definition = excluded.default_schema_definition,
      updated_at = now();

-- Refrigeration (single-form module)
insert into public.module_default_schemas (module_slug, form_type, default_schema_definition)
values (
  'refrigeration',
  null,
  $${
    "$schema": "rink-form-schema/v1",
    "sections": [
      {
        "key": "pressures",
        "label": "Pressures",
        "fields": [
          { "key": "suction_pressure_psi",   "type": "number", "label": "Suction pressure",   "required": false, "unit": "psi" },
          { "key": "discharge_pressure_psi", "type": "number", "label": "Discharge pressure", "required": false, "unit": "psi" },
          { "key": "oil_pressure_psi",       "type": "number", "label": "Oil pressure",       "required": false, "unit": "psi" }
        ]
      },
      {
        "key": "temps_and_flow",
        "label": "Temperatures and flow",
        "fields": [
          { "key": "amps",                 "type": "number", "label": "Amps",               "required": false, "unit": "A" },
          { "key": "oil_temp_f",           "type": "number", "label": "Oil temp",           "required": false, "unit": "°F" },
          { "key": "brine_supply_temp_f",  "type": "number", "label": "Brine supply temp",  "required": false, "unit": "°F" },
          { "key": "brine_return_temp_f",  "type": "number", "label": "Brine return temp",  "required": false, "unit": "°F" },
          { "key": "brine_flow_gpm",       "type": "number", "label": "Brine flow",         "required": false, "unit": "gpm" },
          { "key": "ice_surface_temp_f",   "type": "number", "label": "Ice surface temp",   "required": false, "unit": "°F" }
        ]
      },
      {
        "key": "condenser",
        "label": "Condenser",
        "fields": [
          { "key": "condenser_fan_running", "type": "boolean", "label": "Condenser fan running?", "required": true },
          {
            "key": "condenser_temp_f",
            "type": "number",
            "label": "Condenser temp",
            "required": false,
            "unit": "°F",
            "show_if": { "field": "condenser_fan_running", "equals": true }
          }
        ]
      },
      {
        "key": "notes",
        "label": "Notes",
        "fields": [
          { "key": "operator_notes", "type": "textarea", "label": "Operator notes", "required": false, "rows": 3 }
        ]
      }
    ]
  }$$::jsonb
)
on conflict (module_slug, coalesce(form_type, '')) do update
  set default_schema_definition = excluded.default_schema_definition,
      updated_at = now();

-- Air Quality (single-form module)
insert into public.module_default_schemas (module_slug, form_type, default_schema_definition)
values (
  'air_quality',
  null,
  $${
    "$schema": "rink-form-schema/v1",
    "sections": [
      {
        "key": "gases",
        "label": "Gas readings",
        "fields": [
          { "key": "co_ppm",            "type": "number", "label": "CO",           "required": true,  "min": 0, "max": 100, "step": 0.1, "unit": "ppm" },
          { "key": "no2_ppm",           "type": "number", "label": "NO₂",          "required": true,  "min": 0, "max": 5,   "step": 0.01, "unit": "ppm" },
          { "key": "ozone_ppm",         "type": "number", "label": "Ozone (opt.)", "required": false, "min": 0, "max": 1,   "step": 0.001, "unit": "ppm" }
        ]
      },
      {
        "key": "environment",
        "label": "Environment",
        "fields": [
          { "key": "particulates_ug_m3",     "type": "number", "label": "Particulates",   "required": false, "unit": "µg/m³" },
          { "key": "relative_humidity_pct",  "type": "number", "label": "Relative humidity", "required": false, "min": 0, "max": 100, "step": 1, "unit": "%" },
          { "key": "ambient_temp_f",         "type": "number", "label": "Ambient temp",   "required": false, "unit": "°F" }
        ]
      },
      {
        "key": "method",
        "label": "Method + notes",
        "fields": [
          {
            "key": "reading_method",
            "type": "select",
            "label": "Reading method",
            "required": false,
            "options": [
              { "key": "handheld",   "label": "Handheld" },
              { "key": "fixed",      "label": "Fixed sensor" },
              { "key": "lab_sample", "label": "Lab sample" }
            ]
          },
          { "key": "notes", "type": "textarea", "label": "Notes", "required": false, "rows": 3 }
        ]
      }
    ]
  }$$::jsonb
)
on conflict (module_slug, coalesce(form_type, '')) do update
  set default_schema_definition = excluded.default_schema_definition,
      updated_at = now();

-- Accident (single-form module)
insert into public.module_default_schemas (module_slug, form_type, default_schema_definition)
values (
  'accident',
  null,
  $${
    "$schema": "rink-form-schema/v1",
    "sections": [
      {
        "key": "person",
        "label": "Person involved",
        "fields": [
          { "key": "person_name",    "type": "text",    "label": "Name",    "required": true },
          { "key": "person_contact", "type": "text",    "label": "Contact (phone or email)", "required": false },
          { "key": "person_is_staff","type": "boolean", "label": "Is staff?", "required": false },
          {
            "key": "age_bracket",
            "type": "select",
            "label": "Age bracket",
            "required": false,
            "options": [
              { "key": "minor",   "label": "Minor" },
              { "key": "adult",   "label": "Adult" },
              { "key": "senior",  "label": "Senior" },
              { "key": "unknown", "label": "Unknown" }
            ]
          }
        ]
      },
      {
        "key": "what_happened",
        "label": "What happened",
        "fields": [
          { "key": "description",    "type": "textarea", "label": "Description of accident", "required": true, "rows": 5 },
          { "key": "witness_names",  "type": "textarea", "label": "Witness names",           "required": false, "rows": 2 }
        ]
      },
      {
        "key": "response",
        "label": "Response",
        "fields": [
          { "key": "staff_responding",           "type": "text",    "label": "Staff responding",       "required": false },
          { "key": "emergency_services_called",  "type": "boolean", "label": "Emergency services called?", "required": true },
          { "key": "first_aid_administered",     "type": "boolean", "label": "First aid administered?",    "required": true },
          { "key": "next_of_kin_notified",       "type": "boolean", "label": "Next of kin notified?",      "required": false }
        ]
      },
      {
        "key": "followup",
        "label": "Follow-up",
        "fields": [
          { "key": "followup_required", "type": "boolean",  "label": "Follow-up required?", "required": true },
          {
            "key": "followup_notes",
            "type": "textarea",
            "label": "Follow-up notes",
            "required": false,
            "rows": 3,
            "show_if": { "field": "followup_required", "equals": true }
          }
        ]
      }
    ]
  }$$::jsonb
)
on conflict (module_slug, coalesce(form_type, '')) do update
  set default_schema_definition = excluded.default_schema_definition,
      updated_at = now();

-- Incident (single-form module)
insert into public.module_default_schemas (module_slug, form_type, default_schema_definition)
values (
  'incident',
  null,
  $${
    "$schema": "rink-form-schema/v1",
    "sections": [
      {
        "key": "what_happened",
        "label": "What happened",
        "fields": [
          {
            "key": "incident_type",
            "type": "select",
            "label": "Incident type",
            "required": true,
            "options": [
              { "key": "property_damage", "label": "Property damage" },
              { "key": "near_miss",       "label": "Near miss" },
              { "key": "security",        "label": "Security" },
              { "key": "trespass",        "label": "Trespass" },
              { "key": "other",           "label": "Other" }
            ]
          },
          { "key": "description", "type": "textarea", "label": "Description", "required": true, "rows": 5 }
        ]
      },
      {
        "key": "damage",
        "label": "Damage details",
        "fields": [
          {
            "key": "property_damaged",
            "type": "textarea",
            "label": "Property damaged",
            "required": false,
            "rows": 3,
            "show_if": { "field": "incident_type", "equals": "property_damage" }
          },
          {
            "key": "estimated_cost_usd",
            "type": "number",
            "label": "Estimated cost",
            "required": false,
            "min": 0,
            "step": 1,
            "unit": "USD",
            "show_if": { "field": "incident_type", "equals": "property_damage" }
          }
        ]
      },
      {
        "key": "response",
        "label": "Response",
        "fields": [
          { "key": "staff_responding",      "type": "text",     "label": "Staff responding",   "required": false },
          { "key": "action_taken",          "type": "textarea", "label": "Action taken",       "required": false, "rows": 3 },
          { "key": "law_enforcement_called","type": "boolean",  "label": "Law enforcement called?", "required": false }
        ]
      },
      {
        "key": "followup",
        "label": "Follow-up",
        "fields": [
          { "key": "followup_required", "type": "boolean", "label": "Follow-up required?", "required": true }
        ]
      }
    ]
  }$$::jsonb
)
on conflict (module_slug, coalesce(form_type, '')) do update
  set default_schema_definition = excluded.default_schema_definition,
      updated_at = now();

-- ============================================================================
-- 2. Backfill form_schemas for every existing non-platform facility
-- ============================================================================

-- Ice Maintenance: three new form_types per facility (circle_check is already seeded)
insert into public.form_schemas (facility_id, module_slug, form_type, schema_definition, version, is_published)
select f.id, 'ice_maintenance', 'ice_make',
       (select default_schema_definition from public.module_default_schemas
         where module_slug = 'ice_maintenance' and form_type = 'ice_make'),
       1, true
from public.facilities f
where f.is_platform = false
on conflict (facility_id, module_slug, form_type) where form_type is not null do nothing;

insert into public.form_schemas (facility_id, module_slug, form_type, schema_definition, version, is_published)
select f.id, 'ice_maintenance', 'edging',
       (select default_schema_definition from public.module_default_schemas
         where module_slug = 'ice_maintenance' and form_type = 'edging'),
       1, true
from public.facilities f
where f.is_platform = false
on conflict (facility_id, module_slug, form_type) where form_type is not null do nothing;

insert into public.form_schemas (facility_id, module_slug, form_type, schema_definition, version, is_published)
select f.id, 'ice_maintenance', 'blade_change',
       (select default_schema_definition from public.module_default_schemas
         where module_slug = 'ice_maintenance' and form_type = 'blade_change'),
       1, true
from public.facilities f
where f.is_platform = false
on conflict (facility_id, module_slug, form_type) where form_type is not null do nothing;

-- Refrigeration, Air Quality, Accident, Incident: one row per facility each (form_type null)
insert into public.form_schemas (facility_id, module_slug, form_type, schema_definition, version, is_published)
select f.id, 'refrigeration', null,
       (select default_schema_definition from public.module_default_schemas
         where module_slug = 'refrigeration' and form_type is null),
       1, true
from public.facilities f
where f.is_platform = false
on conflict (facility_id, module_slug) where form_type is null do nothing;

insert into public.form_schemas (facility_id, module_slug, form_type, schema_definition, version, is_published)
select f.id, 'air_quality', null,
       (select default_schema_definition from public.module_default_schemas
         where module_slug = 'air_quality' and form_type is null),
       1, true
from public.facilities f
where f.is_platform = false
on conflict (facility_id, module_slug) where form_type is null do nothing;

insert into public.form_schemas (facility_id, module_slug, form_type, schema_definition, version, is_published)
select f.id, 'accident', null,
       (select default_schema_definition from public.module_default_schemas
         where module_slug = 'accident' and form_type is null),
       1, true
from public.facilities f
where f.is_platform = false
on conflict (facility_id, module_slug) where form_type is null do nothing;

insert into public.form_schemas (facility_id, module_slug, form_type, schema_definition, version, is_published)
select f.id, 'incident', null,
       (select default_schema_definition from public.module_default_schemas
         where module_slug = 'incident' and form_type is null),
       1, true
from public.facilities f
where f.is_platform = false
on conflict (facility_id, module_slug) where form_type is null do nothing;
