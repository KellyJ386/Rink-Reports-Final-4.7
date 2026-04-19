-- 20260422000001_standalone_submission_tables.sql
-- Four new submission tables following Agent 2's contract:
--   refrigeration_submissions, air_quality_submissions,
--   accident_submissions, incident_submissions
--
-- All four follow the convention: ${module_slug}_submissions, no form_type column.
-- Each has the standard columns (id, facility_id, submitted_by, submitted_at,
-- form_schema_version, custom_fields, idempotency_key) plus module-specific core
-- columns defined per Agent 3's first-response plan.
--
-- RLS: facility isolation + has_module_access(<slug>, <level>) per the standard
-- template. Read/Write/Delete levels match the access matrix in the brief
-- (admin>write, manager>write, staff>write; delete requires admin).

-- ============================================================================
-- refrigeration_submissions
-- ============================================================================

create table if not exists public.refrigeration_submissions (
  id                         uuid primary key default gen_random_uuid(),
  facility_id                uuid not null default public.current_facility_id()
                               references public.facilities(id) on delete cascade,
  submitted_by               uuid not null references public.users(id) on delete restrict,
  submitted_at               timestamptz not null default now(),
  form_schema_version        integer not null,

  -- Core
  reading_taken_at           timestamptz not null,
  compressor_resource_id     uuid not null references public.facility_resources(id) on delete restrict,

  custom_fields              jsonb not null default '{}'::jsonb,
  idempotency_key            text
);

create index if not exists refrigeration_submissions_facility_reading_idx
  on public.refrigeration_submissions (facility_id, reading_taken_at desc);

create index if not exists refrigeration_submissions_compressor_reading_idx
  on public.refrigeration_submissions (facility_id, compressor_resource_id, reading_taken_at desc);

create unique index if not exists refrigeration_submissions_idempotency_key
  on public.refrigeration_submissions (facility_id, idempotency_key)
  where idempotency_key is not null;

alter table public.refrigeration_submissions enable row level security;

drop policy if exists refrigeration_submissions_select on public.refrigeration_submissions;
create policy refrigeration_submissions_select on public.refrigeration_submissions
  for select to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('refrigeration', 'read'))
  );

drop policy if exists refrigeration_submissions_insert on public.refrigeration_submissions;
create policy refrigeration_submissions_insert on public.refrigeration_submissions
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('refrigeration', 'write'))
  );

drop policy if exists refrigeration_submissions_update on public.refrigeration_submissions;
create policy refrigeration_submissions_update on public.refrigeration_submissions
  for update to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('refrigeration', 'write'))
  )
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('refrigeration', 'write'))
  );

drop policy if exists refrigeration_submissions_delete on public.refrigeration_submissions;
create policy refrigeration_submissions_delete on public.refrigeration_submissions
  for delete to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('refrigeration', 'admin'))
  );

comment on table public.refrigeration_submissions is
  'Refrigeration readings. One row per reading per compressor. Schema-driven custom fields in custom_fields jsonb.';

-- ============================================================================
-- air_quality_submissions
-- ============================================================================

create table if not exists public.air_quality_submissions (
  id                      uuid primary key default gen_random_uuid(),
  facility_id             uuid not null default public.current_facility_id()
                            references public.facilities(id) on delete cascade,
  submitted_by            uuid not null references public.users(id) on delete restrict,
  submitted_at            timestamptz not null default now(),
  form_schema_version     integer not null,

  -- Core
  reading_taken_at        timestamptz not null,
  device_resource_id      uuid not null references public.facility_resources(id) on delete restrict,
  location_of_reading     text not null check (length(location_of_reading) > 0),

  custom_fields           jsonb not null default '{}'::jsonb,
  idempotency_key         text
);

create index if not exists air_quality_submissions_facility_reading_idx
  on public.air_quality_submissions (facility_id, reading_taken_at desc);

create index if not exists air_quality_submissions_device_reading_idx
  on public.air_quality_submissions (facility_id, device_resource_id, reading_taken_at desc);

create unique index if not exists air_quality_submissions_idempotency_key
  on public.air_quality_submissions (facility_id, idempotency_key)
  where idempotency_key is not null;

alter table public.air_quality_submissions enable row level security;

drop policy if exists air_quality_submissions_select on public.air_quality_submissions;
create policy air_quality_submissions_select on public.air_quality_submissions
  for select to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('air_quality', 'read'))
  );

drop policy if exists air_quality_submissions_insert on public.air_quality_submissions;
create policy air_quality_submissions_insert on public.air_quality_submissions
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('air_quality', 'write'))
  );

drop policy if exists air_quality_submissions_update on public.air_quality_submissions;
create policy air_quality_submissions_update on public.air_quality_submissions
  for update to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('air_quality', 'write'))
  )
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('air_quality', 'write'))
  );

drop policy if exists air_quality_submissions_delete on public.air_quality_submissions;
create policy air_quality_submissions_delete on public.air_quality_submissions
  for delete to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('air_quality', 'admin'))
  );

comment on table public.air_quality_submissions is
  'Air quality readings (CO, NO2, particulates, etc). Schema-driven custom fields in custom_fields.';

-- ============================================================================
-- accident_submissions
-- ============================================================================

create table if not exists public.accident_submissions (
  id                      uuid primary key default gen_random_uuid(),
  facility_id             uuid not null default public.current_facility_id()
                            references public.facilities(id) on delete cascade,
  submitted_by            uuid not null references public.users(id) on delete restrict,
  submitted_at            timestamptz not null default now(),
  form_schema_version     integer not null,

  -- Core
  date_of_accident        date not null,
  time_of_accident        time not null,
  location_in_facility    text not null check (length(location_in_facility) > 0),

  custom_fields           jsonb not null default '{}'::jsonb,
  idempotency_key         text
);

create index if not exists accident_submissions_facility_date_idx
  on public.accident_submissions (facility_id, date_of_accident desc, time_of_accident desc);

create unique index if not exists accident_submissions_idempotency_key
  on public.accident_submissions (facility_id, idempotency_key)
  where idempotency_key is not null;

alter table public.accident_submissions enable row level security;

drop policy if exists accident_submissions_select on public.accident_submissions;
create policy accident_submissions_select on public.accident_submissions
  for select to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('accident', 'read'))
  );

drop policy if exists accident_submissions_insert on public.accident_submissions;
create policy accident_submissions_insert on public.accident_submissions
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('accident', 'write'))
  );

drop policy if exists accident_submissions_update on public.accident_submissions;
create policy accident_submissions_update on public.accident_submissions
  for update to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('accident', 'write'))
  )
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('accident', 'write'))
  );

drop policy if exists accident_submissions_delete on public.accident_submissions;
create policy accident_submissions_delete on public.accident_submissions
  for delete to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('accident', 'admin'))
  );

comment on table public.accident_submissions is
  'Injury reports for guests or non-employees. Legal retention — never hard-delete in practice. Schema-driven custom fields.';

-- ============================================================================
-- incident_submissions
-- ============================================================================

create table if not exists public.incident_submissions (
  id                      uuid primary key default gen_random_uuid(),
  facility_id             uuid not null default public.current_facility_id()
                            references public.facilities(id) on delete cascade,
  submitted_by            uuid not null references public.users(id) on delete restrict,
  submitted_at            timestamptz not null default now(),
  form_schema_version     integer not null,

  -- Core
  date_of_incident        date not null,
  time_of_incident        time not null,
  location_in_facility    text not null check (length(location_in_facility) > 0),

  custom_fields           jsonb not null default '{}'::jsonb,
  idempotency_key         text
);

create index if not exists incident_submissions_facility_date_idx
  on public.incident_submissions (facility_id, date_of_incident desc, time_of_incident desc);

create unique index if not exists incident_submissions_idempotency_key
  on public.incident_submissions (facility_id, idempotency_key)
  where idempotency_key is not null;

alter table public.incident_submissions enable row level security;

drop policy if exists incident_submissions_select on public.incident_submissions;
create policy incident_submissions_select on public.incident_submissions
  for select to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('incident', 'read'))
  );

drop policy if exists incident_submissions_insert on public.incident_submissions;
create policy incident_submissions_insert on public.incident_submissions
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('incident', 'write'))
  );

drop policy if exists incident_submissions_update on public.incident_submissions;
create policy incident_submissions_update on public.incident_submissions
  for update to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('incident', 'write'))
  )
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('incident', 'write'))
  );

drop policy if exists incident_submissions_delete on public.incident_submissions;
create policy incident_submissions_delete on public.incident_submissions
  for delete to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('incident', 'admin'))
  );

comment on table public.incident_submissions is
  'Property damage / near-miss / non-injury event reports. Schema-driven custom fields.';
