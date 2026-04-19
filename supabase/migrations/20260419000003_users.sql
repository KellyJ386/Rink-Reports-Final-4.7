-- 20260419000003_users.sql
-- User profile table. Extends Supabase auth.users 1:1.
--
-- Invariants:
--   * facility_id is NOT NULL and immutable post-creation. A trigger blocks facility_id
--     updates from anyone except the service role. Moving a user between facilities
--     requires direct DB work + audit_log entry — not self-serve.
--   * active gates authentication. Middleware (middleware.ts) rejects requests from
--     users with active = false on every authenticated request. Deactivation = logout.
--   * email is citext so comparisons are case-insensitive without lower() everywhere.

create table if not exists public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  facility_id     uuid not null references public.facilities(id) on delete restrict,
  full_name       text,
  email           citext not null,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint users_email_key unique (email)
);

create index if not exists users_facility_id_idx
  on public.users (facility_id);

create index if not exists users_active_idx
  on public.users (active)
  where active = false;

drop trigger if exists users_touch_updated_at on public.users;
create trigger users_touch_updated_at
  before update on public.users
  for each row execute function public.tg_touch_updated_at();

-- Immutability trigger on facility_id.
--
-- The service role (Supabase service key, used by admin scripts and platform admin actions)
-- bypasses RLS and therefore bypasses this trigger only if it sets the session role to
-- 'supabase_admin' / 'postgres'. For application code running as `authenticated`, this
-- trigger fires and blocks the update.
--
-- Platform admins moving a user between facilities MUST do it via direct SQL as the
-- service role, and MUST write an audit_log entry. Agent 7's runbook covers this.
create or replace function public.tg_users_prevent_facility_change()
returns trigger
language plpgsql
as $$
begin
  if new.facility_id is distinct from old.facility_id then
    if current_setting('request.jwt.claims', true) is not null then
      raise exception 'users.facility_id is immutable. Moving users between facilities requires direct DB access as the service role plus an audit_log entry.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists users_prevent_facility_change on public.users;
create trigger users_prevent_facility_change
  before update of facility_id on public.users
  for each row execute function public.tg_users_prevent_facility_change();

alter table public.users enable row level security;

comment on table public.users is
  'Profile table extending auth.users. facility_id is immutable post-creation.';
comment on column public.users.facility_id is
  'Tenant key. Immutable from application code. Platform admin service-role only can rewrite, with audit_log entry.';
comment on column public.users.active is
  'False disables login. Middleware enforces on every authenticated request. Never hard-delete a user.';
