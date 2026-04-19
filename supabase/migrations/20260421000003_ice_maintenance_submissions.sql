-- 20260421000003_ice_maintenance_submissions.sql
-- The submission table for all four Ice Maintenance form types. Discriminated by
-- `form_type`. Agent 3 adds Ice Make, Edging, Blade Change form types without touching
-- this schema — they share the table.
--
-- Core columns layered by form_type:
--   common:          surface_resource_id
--   ice_make:        water_temp_f, resurface_start_at, resurface_end_at
--   circle_check:    (no additional core)
--   edging:          (no additional core)
--   blade_change:    zamboni_resource_id, blade_serial
--
-- Columns that don't apply to a given form_type stay null. Zod enforcement of
-- per-form-type required-ness lives in the core-fields.ts registry file for each
-- form type, not at the DB level.

create table if not exists public.ice_maintenance_submissions (
  id                      uuid primary key default gen_random_uuid(),
  facility_id             uuid not null default public.current_facility_id()
                            references public.facilities(id) on delete cascade,
  submitted_by            uuid not null references public.users(id) on delete restrict,
  submitted_at            timestamptz not null default now(),
  form_type               text not null
                          check (form_type in ('ice_make', 'circle_check', 'edging', 'blade_change')),
  form_schema_version     integer not null,

  -- Common core
  surface_resource_id     uuid not null references public.facility_resources(id) on delete restrict,

  -- Ice Make core (null for other form types)
  water_temp_f            numeric,
  resurface_start_at      timestamptz,
  resurface_end_at        timestamptz,

  -- Blade Change core (null for other form types)
  zamboni_resource_id     uuid references public.facility_resources(id) on delete restrict,
  blade_serial            text,

  -- Custom fields per schema_definition at submission time
  custom_fields           jsonb not null default '{}'::jsonb,

  -- Offline idempotency
  idempotency_key         text
);

create index if not exists ice_maintenance_submissions_facility_submitted_idx
  on public.ice_maintenance_submissions (facility_id, submitted_at desc);

create index if not exists ice_maintenance_submissions_facility_form_type_idx
  on public.ice_maintenance_submissions (facility_id, form_type, submitted_at desc);

create index if not exists ice_maintenance_submissions_surface_submitted_idx
  on public.ice_maintenance_submissions (facility_id, surface_resource_id, submitted_at desc);

-- Partial unique on idempotency_key (null → allow many)
create unique index if not exists ice_maintenance_submissions_idempotency_key
  on public.ice_maintenance_submissions (facility_id, idempotency_key)
  where idempotency_key is not null;

alter table public.ice_maintenance_submissions enable row level security;

-- RLS: facility isolation + module access check (ice_maintenance).

drop policy if exists ice_maintenance_submissions_select on public.ice_maintenance_submissions;
create policy ice_maintenance_submissions_select on public.ice_maintenance_submissions
  for select to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('ice_maintenance', 'read'))
  );

drop policy if exists ice_maintenance_submissions_insert on public.ice_maintenance_submissions;
create policy ice_maintenance_submissions_insert on public.ice_maintenance_submissions
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('ice_maintenance', 'write'))
  );

drop policy if exists ice_maintenance_submissions_update on public.ice_maintenance_submissions;
create policy ice_maintenance_submissions_update on public.ice_maintenance_submissions
  for update to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('ice_maintenance', 'write'))
  )
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('ice_maintenance', 'write'))
  );

drop policy if exists ice_maintenance_submissions_delete on public.ice_maintenance_submissions;
create policy ice_maintenance_submissions_delete on public.ice_maintenance_submissions
  for delete to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('ice_maintenance', 'admin'))
  );

comment on table public.ice_maintenance_submissions is
  'Single table for all four Ice Maintenance form types (ice_make, circle_check, edging, blade_change). Form-type-specific core columns are nullable; Zod enforcement lives in core-fields.ts per form type.';
