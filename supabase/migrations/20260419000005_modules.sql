-- 20260419000005_modules.sql
-- The module catalog (global) and the per-facility enablement + per-role access tables.
--
-- Design notes:
--   * modules is global. All facilities see the same catalog.
--   * facility_modules tracks which modules each facility has enabled.
--   * role_module_access tracks per-role access level for each module
--     (none | read | write | admin). Stored as text for readability; validated by
--     check constraint; compared by ordinal in has_module_access().
--   * Category taxonomy: operations | safety | hr | communications | admin.

create table if not exists public.modules (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null,
  name            text not null,
  description     text,
  category        text not null
                  check (category in ('operations', 'safety', 'hr', 'communications', 'admin')),
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint modules_slug_key unique (slug),
  constraint modules_slug_format_chk check (slug ~ '^[a-z][a-z0-9_]{0,63}$')
);

drop trigger if exists modules_touch_updated_at on public.modules;
create trigger modules_touch_updated_at
  before update on public.modules
  for each row execute function public.tg_touch_updated_at();

alter table public.modules enable row level security;

-- Seed the catalog. All 8 operational modules + Admin Control Center.
insert into public.modules (slug, name, description, category, sort_order)
values
  ('ice_depth', 'Ice Depth', 'Ice thickness measurements at fixed points', 'operations', 10),
  ('ice_maintenance', 'Ice Maintenance',
    'Ice Make, Circle Check, Edging, Blade Change', 'operations', 20),
  ('refrigeration', 'Refrigeration Report',
    'Compressor and brine readings', 'operations', 30),
  ('air_quality', 'Air Quality Report',
    'CO, NO2, particulate readings', 'operations', 40),
  ('accident', 'Accident Report',
    'Injury to a guest or non-employee', 'safety', 50),
  ('incident', 'Incident Report',
    'Property damage, near-miss, non-injury event', 'safety', 60),
  ('scheduling', 'Employee Scheduling',
    'Weekly schedules, availability, time-off, shift swaps', 'hr', 70),
  ('communications', 'Communications',
    'Facility-wide announcements with read receipts and acknowledgment', 'communications', 80),
  ('admin_control_center', 'Admin Control Center',
    'Facility configuration: users, roles, modules, forms, resources', 'admin', 90)
on conflict (slug) do nothing;

-- facility_modules: which modules each facility has enabled.

create table if not exists public.facility_modules (
  facility_id     uuid not null references public.facilities(id) on delete cascade,
  module_id       uuid not null references public.modules(id) on delete restrict,
  is_enabled      boolean not null default true,
  enabled_at      timestamptz not null default now(),

  primary key (facility_id, module_id)
);

create index if not exists facility_modules_facility_idx
  on public.facility_modules (facility_id);

alter table public.facility_modules enable row level security;

-- role_module_access: per-role access level per module.

create table if not exists public.role_module_access (
  role_id         uuid not null references public.roles(id) on delete cascade,
  module_id       uuid not null references public.modules(id) on delete restrict,
  access_level    text not null default 'none'
                  check (access_level in ('none', 'read', 'write', 'admin')),
  updated_at      timestamptz not null default now(),

  primary key (role_id, module_id)
);

drop trigger if exists role_module_access_touch_updated_at on public.role_module_access;
create trigger role_module_access_touch_updated_at
  before update on public.role_module_access
  for each row execute function public.tg_touch_updated_at();

alter table public.role_module_access enable row level security;

comment on table public.modules is
  'Global module catalog. Append-only in practice. Platform admins add new modules across releases.';
comment on table public.facility_modules is
  'Per-facility module enablement. Disabled = routes 404 for that facility.';
comment on table public.role_module_access is
  'Per-role access per module. Levels ordered none < read < write < admin.';
