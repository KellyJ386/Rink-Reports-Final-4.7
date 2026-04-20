-- 20260423000001_ice_depth_tables.sql
-- Ice Depth module. Custom-UI module (not form-engine-driven).
--
-- Four tables:
--   ice_depth_templates         — per (facility, surface); current + draft points
--   ice_depth_template_history  — append-only snapshot per publish
--   ice_depth_sessions          — submission table; standard columns + template pin
--   ice_depth_readings          — one row per (session, point_key); upsert-friendly
--
-- Version + history pattern mirrors form_schemas exactly. Sessions pin
-- form_schema_version to the template version at session start; detail views render
-- against the historical snapshot, not the live template.

-- ============================================================================
-- ice_depth_templates
-- ============================================================================

create table if not exists public.ice_depth_templates (
  id                      uuid primary key default gen_random_uuid(),
  facility_id             uuid not null default public.current_facility_id()
                            references public.facilities(id) on delete cascade,
  surface_resource_id     uuid not null references public.facility_resources(id) on delete restrict,
  name                    text not null check (length(name) > 0 and length(name) <= 120),
  svg_key                 text not null check (svg_key in ('nhl', 'olympic', 'studio')),
  current_points          jsonb not null default '[]'::jsonb,
  draft_points            jsonb,
  version                 integer not null default 1,
  is_published            boolean not null default true,
  updated_at              timestamptz not null default now(),
  updated_by              uuid references public.users(id) on delete set null
);

create unique index if not exists ice_depth_templates_facility_surface_key
  on public.ice_depth_templates (facility_id, surface_resource_id);

drop trigger if exists ice_depth_templates_touch_updated_at on public.ice_depth_templates;
create trigger ice_depth_templates_touch_updated_at
  before update on public.ice_depth_templates
  for each row execute function public.tg_touch_updated_at();

-- Surface reference must actually be a surface (not a compressor, zamboni, etc).
create or replace function public.tg_ice_depth_templates_surface_check()
returns trigger
language plpgsql
as $$
declare
  r_type text;
begin
  select resource_type into r_type from public.facility_resources
    where id = new.surface_resource_id;
  if r_type is distinct from 'surface' then
    raise exception 'ice_depth_templates.surface_resource_id must reference a facility_resources row with resource_type = ''surface'' (got %)', coalesce(r_type, 'null')
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists ice_depth_templates_surface_check on public.ice_depth_templates;
create trigger ice_depth_templates_surface_check
  before insert or update of surface_resource_id on public.ice_depth_templates
  for each row execute function public.tg_ice_depth_templates_surface_check();

-- Protect point keys that are already referenced by readings. A publish that changes
-- current_points is fine (version bumps; history preserves the old keys). But editing
-- current_points directly via UPDATE (only possible for the publish RPC, which sets
-- draft_points → current_points atomically) must not remove a key that has historical
-- readings referencing the current template version. We defer this invariant to the
-- publish RPC's validation rather than the trigger layer; a schema-edit-in-place
-- UPDATE path isn't exposed to clients (RLS + admin-only writes, and the publish RPC
-- handles atomicity).

alter table public.ice_depth_templates enable row level security;

-- RLS: read by anyone in facility; write gated by has_module_access('ice_depth', 'admin')
-- per Agent 4's decision (module-scoped admin, not Admin Control Center scoped).
drop policy if exists ice_depth_templates_select on public.ice_depth_templates;
create policy ice_depth_templates_select on public.ice_depth_templates
  for select to authenticated
  using (
    public.is_platform_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists ice_depth_templates_insert on public.ice_depth_templates;
create policy ice_depth_templates_insert on public.ice_depth_templates
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('ice_depth', 'admin'))
  );

drop policy if exists ice_depth_templates_update on public.ice_depth_templates;
create policy ice_depth_templates_update on public.ice_depth_templates
  for update to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('ice_depth', 'admin'))
  )
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('ice_depth', 'admin'))
  );

drop policy if exists ice_depth_templates_delete on public.ice_depth_templates;
create policy ice_depth_templates_delete on public.ice_depth_templates
  for delete to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('ice_depth', 'admin'))
  );

comment on table public.ice_depth_templates is
  'One per (facility, surface). Current + draft points; version bumps only on publish. Mirrors form_schemas pattern.';

-- ============================================================================
-- ice_depth_template_history
-- ============================================================================

create table if not exists public.ice_depth_template_history (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references public.facilities(id) on delete cascade,
  template_id     uuid not null references public.ice_depth_templates(id) on delete cascade,
  version         integer not null,
  svg_key         text not null,
  points          jsonb not null,
  published_by    uuid references public.users(id) on delete set null,
  published_at    timestamptz not null default now()
);

create unique index if not exists ice_depth_template_history_tv_key
  on public.ice_depth_template_history (template_id, version);

create index if not exists ice_depth_template_history_facility_idx
  on public.ice_depth_template_history (facility_id, template_id, version desc);

alter table public.ice_depth_template_history enable row level security;

drop policy if exists ice_depth_template_history_select on public.ice_depth_template_history;
create policy ice_depth_template_history_select on public.ice_depth_template_history
  for select to authenticated
  using (
    public.is_platform_admin()
    or facility_id = public.current_facility_id()
  );

-- Append-only; INSERT via SECURITY DEFINER publish RPC only. UPDATE + DELETE blocked.
create or replace function public.tg_ice_depth_template_history_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ice_depth_template_history is append-only. UPDATE and DELETE are not permitted.'
    using errcode = '42501';
end;
$$;

drop trigger if exists ice_depth_template_history_block_update on public.ice_depth_template_history;
create trigger ice_depth_template_history_block_update
  before update on public.ice_depth_template_history
  for each row execute function public.tg_ice_depth_template_history_append_only();

drop trigger if exists ice_depth_template_history_block_delete on public.ice_depth_template_history;
create trigger ice_depth_template_history_block_delete
  before delete on public.ice_depth_template_history
  for each row execute function public.tg_ice_depth_template_history_append_only();

comment on table public.ice_depth_template_history is
  'Append-only snapshot of every published template version. Detail views read here by pinned form_schema_version so historical sessions render against the template they were filed under.';

-- ============================================================================
-- ice_depth_sessions
-- ============================================================================

create table if not exists public.ice_depth_sessions (
  id                      uuid primary key default gen_random_uuid(),
  facility_id             uuid not null default public.current_facility_id()
                            references public.facilities(id) on delete cascade,
  submitted_by            uuid not null references public.users(id) on delete restrict,
  submitted_at            timestamptz not null default now(),
  form_schema_version     integer not null,

  template_id             uuid not null references public.ice_depth_templates(id) on delete restrict,
  surface_resource_id     uuid not null references public.facility_resources(id) on delete restrict,
  notes                   text,
  status                  text not null default 'in_progress'
                          check (status in ('in_progress', 'completed', 'abandoned')),

  custom_fields           jsonb not null default '{}'::jsonb,
  idempotency_key         text
);

create index if not exists ice_depth_sessions_facility_submitted_idx
  on public.ice_depth_sessions (facility_id, submitted_at desc);

create index if not exists ice_depth_sessions_surface_submitted_idx
  on public.ice_depth_sessions (facility_id, surface_resource_id, submitted_at desc);

create index if not exists ice_depth_sessions_template_version_idx
  on public.ice_depth_sessions (facility_id, template_id, form_schema_version);

create unique index if not exists ice_depth_sessions_idempotency_key
  on public.ice_depth_sessions (facility_id, idempotency_key)
  where idempotency_key is not null;

alter table public.ice_depth_sessions enable row level security;

drop policy if exists ice_depth_sessions_select on public.ice_depth_sessions;
create policy ice_depth_sessions_select on public.ice_depth_sessions
  for select to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('ice_depth', 'read'))
  );

drop policy if exists ice_depth_sessions_insert on public.ice_depth_sessions;
create policy ice_depth_sessions_insert on public.ice_depth_sessions
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('ice_depth', 'write'))
  );

drop policy if exists ice_depth_sessions_update on public.ice_depth_sessions;
create policy ice_depth_sessions_update on public.ice_depth_sessions
  for update to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('ice_depth', 'write'))
  )
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('ice_depth', 'write'))
  );

drop policy if exists ice_depth_sessions_delete on public.ice_depth_sessions;
create policy ice_depth_sessions_delete on public.ice_depth_sessions
  for delete to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('ice_depth', 'admin'))
  );

comment on table public.ice_depth_sessions is
  'Submission table for Ice Depth. Status: in_progress → completed; abandoned reserved for future Agent 6 cleanup. form_schema_version pins to the template version at session start.';

-- ============================================================================
-- ice_depth_readings
-- ============================================================================

create table if not exists public.ice_depth_readings (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.ice_depth_sessions(id) on delete cascade,
  point_key       text not null check (point_key ~ '^[a-z0-9][a-z0-9_]*$'),
  depth_mm        numeric not null check (depth_mm >= 0 and depth_mm <= 500),
  recorded_at     timestamptz not null default now()
);

create unique index if not exists ice_depth_readings_session_point_key
  on public.ice_depth_readings (session_id, point_key);

create index if not exists ice_depth_readings_session_idx
  on public.ice_depth_readings (session_id);

alter table public.ice_depth_readings enable row level security;

-- Readings inherit RLS from the parent session: a user who can SELECT/UPDATE a session
-- can act on its readings. We join through sessions to get facility_id + module access.

drop policy if exists ice_depth_readings_select on public.ice_depth_readings;
create policy ice_depth_readings_select on public.ice_depth_readings
  for select to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.ice_depth_sessions s
      where s.id = ice_depth_readings.session_id
        and s.facility_id = public.current_facility_id()
        and public.has_module_access('ice_depth', 'read')
    )
  );

drop policy if exists ice_depth_readings_insert on public.ice_depth_readings;
create policy ice_depth_readings_insert on public.ice_depth_readings
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or exists (
      select 1 from public.ice_depth_sessions s
      where s.id = ice_depth_readings.session_id
        and s.facility_id = public.current_facility_id()
        and public.has_module_access('ice_depth', 'write')
    )
  );

drop policy if exists ice_depth_readings_update on public.ice_depth_readings;
create policy ice_depth_readings_update on public.ice_depth_readings
  for update to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.ice_depth_sessions s
      where s.id = ice_depth_readings.session_id
        and s.facility_id = public.current_facility_id()
        and public.has_module_access('ice_depth', 'write')
    )
  );

drop policy if exists ice_depth_readings_delete on public.ice_depth_readings;
create policy ice_depth_readings_delete on public.ice_depth_readings
  for delete to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.ice_depth_sessions s
      where s.id = ice_depth_readings.session_id
        and s.facility_id = public.current_facility_id()
        and public.has_module_access('ice_depth', 'write')
    )
  );

comment on table public.ice_depth_readings is
  'One per (session, point_key). depth_mm bounded 0-500. Composite unique index makes tapping a point a clean upsert.';
