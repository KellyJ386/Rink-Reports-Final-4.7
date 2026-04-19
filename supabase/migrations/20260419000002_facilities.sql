-- 20260419000002_facilities.sql
-- Tenants. The `facilities` table is the root of multi-tenancy.
--
-- Design notes:
--   * `slug` is human-readable, URL-safe, and unique. The Platform Operations facility
--     uses slug = 'platform'. Used in logs and admin navigation; never the UUID.
--   * `is_platform` marks the single Platform Operations facility that holds platform
--     admins' `facility_id`. Partial unique index enforces at-most-one.
--   * `settings jsonb` is the per-facility config bag. The key catalog is maintained in
--     ADMIN.md by Agent 6. Keys are enumerated and validated by owning agents; there is
--     no generic "save any JSON" action.
--   * `timezone` is derived from address ZIP at creation (Agent 1b); stored as text
--     (IANA tz, e.g. "America/Toronto"); editable by facility admin via Agent 6.
--   * `address` is jsonb with flexible shape. v1 fields: street, city, state, postal_code.

create table if not exists public.facilities (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null,
  name            text not null,
  timezone        text not null,
  address         jsonb not null default '{}'::jsonb,
  plan_tier       text not null default 'trial'
                  check (plan_tier in ('trial', 'single_facility', 'multi_facility', 'enterprise')),
  is_platform     boolean not null default false,
  settings        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint facilities_slug_format_chk
    check (slug ~ '^[a-z0-9][a-z0-9_-]{0,63}$')
);

-- Uniqueness
create unique index if not exists facilities_slug_key
  on public.facilities (slug);

-- At most one platform facility
create unique index if not exists one_platform_facility
  on public.facilities ((true))
  where is_platform;

-- Touch updated_at on every update
create or replace function public.tg_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists facilities_touch_updated_at on public.facilities;
create trigger facilities_touch_updated_at
  before update on public.facilities
  for each row execute function public.tg_touch_updated_at();

-- RLS will be enabled in 20260419000009_rls_policies.sql alongside every other tenant table.
alter table public.facilities enable row level security;

comment on table public.facilities is
  'Tenants. One row per ice rink facility. Platform Operations is a sentinel row marked is_platform = true.';
comment on column public.facilities.slug is
  'Human-readable, URL-safe identifier. Platform Operations = ''platform''. Unique.';
comment on column public.facilities.is_platform is
  'True only for the single Platform Operations sentinel facility. Enforced by partial unique index.';
comment on column public.facilities.settings is
  'Per-facility config bag. Keys enumerated in ADMIN.md. Never accept arbitrary JSON from client.';
