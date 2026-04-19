-- 20260420000002_facility_resources.sql
-- Per-facility entities referenced by form schemas and modules.
--
-- resource_type values (extensible; no CHECK that enumerates them):
--   'surface'             — ice sheets (Ice Depth, Ice Maintenance)
--   'compressor'          — refrigeration compressors (Refrigeration Report)
--   'zamboni'             — ice resurfacers (Ice Maintenance blade change)
--   'air_quality_device'  — CO/NO2 sensors (Air Quality Report)
--   'shift_position'      — scheduling positions (Employee Scheduling)
--
-- Agent 2's option source DSL supports `{ from_resource_type: "<type>" }` which
-- queries this table filtered to the current facility, is_active = true, sorted by
-- sort_order.

create table if not exists public.facility_resources (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null default public.current_facility_id()
                    references public.facilities(id) on delete cascade,
  resource_type   text not null,
  name            text not null,
  sort_order      integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint facility_resources_type_format_chk
    check (resource_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint facility_resources_name_nonempty_chk
    check (length(name) > 0)
);

create index if not exists facility_resources_facility_type_idx
  on public.facility_resources (facility_id, resource_type, is_active, sort_order);

drop trigger if exists facility_resources_touch_updated_at on public.facility_resources;
create trigger facility_resources_touch_updated_at
  before update on public.facility_resources
  for each row execute function public.tg_touch_updated_at();

alter table public.facility_resources enable row level security;

-- RLS: read by anyone in facility (option pickers need to see resources); write by
-- admin_control_center admins only.

drop policy if exists facility_resources_select on public.facility_resources;
create policy facility_resources_select on public.facility_resources
  for select to authenticated
  using (
    public.is_platform_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists facility_resources_insert on public.facility_resources;
create policy facility_resources_insert on public.facility_resources
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  );

drop policy if exists facility_resources_update on public.facility_resources;
create policy facility_resources_update on public.facility_resources
  for update to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  )
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  );

drop policy if exists facility_resources_delete on public.facility_resources;
create policy facility_resources_delete on public.facility_resources
  for delete to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  );

-- Helper block deletion when referenced by historical data. v1 has no FK ref-counters,
-- so deactivate (is_active = false) is the recommended pattern — documented in ADMIN.md.

comment on table public.facility_resources is
  'Per-facility entities (surfaces, compressors, zambonis, shift positions, devices). Referenced by form schemas via from_resource_type option source.';
comment on column public.facility_resources.is_active is
  'Deactivated resources stay referenced by history but disappear from new-form pickers. Prefer deactivation over deletion.';
