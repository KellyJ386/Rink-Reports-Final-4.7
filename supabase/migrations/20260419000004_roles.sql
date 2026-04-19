-- 20260419000004_roles.sql
-- Per-facility roles and the user↔role join.
--
-- Design notes:
--   * Roles are per-facility, not global. A role in Facility A is not visible to
--     Facility B. Role names may collide across facilities.
--   * is_system = true flags seeded system roles ("Admin", etc.) that cannot be
--     renamed or deleted. Enforced by trigger.
--   * user_roles has a trigger asserting user.facility_id = role.facility_id. This
--     prevents a cross-facility role assignment even if the service role tries.

create table if not exists public.roles (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references public.facilities(id) on delete cascade,
  name            text not null,
  description     text,
  is_system       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint roles_name_per_facility_key unique (facility_id, name),
  constraint roles_name_format_chk check (length(name) between 1 and 64)
);

create index if not exists roles_facility_id_idx
  on public.roles (facility_id);

drop trigger if exists roles_touch_updated_at on public.roles;
create trigger roles_touch_updated_at
  before update on public.roles
  for each row execute function public.tg_touch_updated_at();

-- Block delete + rename of system roles. Only the service role may adjust these.
create or replace function public.tg_roles_protect_system()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and old.is_system then
    raise exception 'Cannot delete a system role (%). Archive or rename facility-level roles instead.', old.name
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and old.is_system and new.name is distinct from old.name then
    raise exception 'Cannot rename a system role (%).', old.name
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.is_system is distinct from old.is_system then
    raise exception 'is_system is immutable on existing role rows.'
      using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists roles_protect_system on public.roles;
create trigger roles_protect_system
  before update or delete on public.roles
  for each row execute function public.tg_roles_protect_system();

alter table public.roles enable row level security;

-- user_roles join table

create table if not exists public.user_roles (
  user_id         uuid not null references public.users(id) on delete cascade,
  role_id         uuid not null references public.roles(id) on delete cascade,
  assigned_at     timestamptz not null default now(),
  assigned_by     uuid references public.users(id) on delete set null,

  primary key (user_id, role_id)
);

create index if not exists user_roles_role_id_idx
  on public.user_roles (role_id);

-- Consistency trigger: a user may only be assigned roles in their own facility.
create or replace function public.tg_user_roles_facility_match()
returns trigger
language plpgsql
as $$
declare
  u_facility uuid;
  r_facility uuid;
begin
  select facility_id into u_facility from public.users where id = new.user_id;
  select facility_id into r_facility from public.roles where id = new.role_id;

  if u_facility is null then
    raise exception 'user_roles: user % does not exist.', new.user_id
      using errcode = '23503';
  end if;

  if r_facility is null then
    raise exception 'user_roles: role % does not exist.', new.role_id
      using errcode = '23503';
  end if;

  if u_facility is distinct from r_facility then
    raise exception 'user_roles: user facility (%) does not match role facility (%).', u_facility, r_facility
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists user_roles_facility_match on public.user_roles;
create trigger user_roles_facility_match
  before insert or update on public.user_roles
  for each row execute function public.tg_user_roles_facility_match();

alter table public.user_roles enable row level security;

comment on table public.roles is
  'Per-facility roles. is_system roles cannot be renamed or deleted.';
comment on table public.user_roles is
  'Join table. Trigger enforces user.facility_id = role.facility_id.';
