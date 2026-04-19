-- 20260420000004_facility_invites.sql
-- Invite table. Tokens stored as SHA-256 hex hashes — raw token delivered once via
-- email link, never persisted.
--
-- Lifecycle:
--   created → accepted (accepted_at set)
--   created → revoked (revoked_at set)
--   created → expired (expires_at passes)
--   Tokens are one-shot: after accepted_at is set, the token is dead.
--
-- Indexes:
--   * unique(token_hash) — constant-time lookup at accept time
--   * partial unique (facility_id, lower(email)) where outstanding — prevents
--     issuing multiple live invites to the same email for the same facility

create table if not exists public.facility_invites (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null default public.current_facility_id()
                    references public.facilities(id) on delete cascade,
  email           citext not null,
  role_id         uuid not null references public.roles(id) on delete restrict,
  invited_by      uuid not null references public.users(id) on delete restrict,
  token_hash      text not null,
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),

  constraint facility_invites_token_hash_format_chk
    check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint facility_invites_expiry_future_chk
    check (expires_at > created_at),
  constraint facility_invites_lifecycle_chk
    check (not (accepted_at is not null and revoked_at is not null))
);

create unique index if not exists facility_invites_token_hash_key
  on public.facility_invites (token_hash);

create unique index if not exists facility_invites_outstanding_email_key
  on public.facility_invites (facility_id, lower(email))
  where accepted_at is null and revoked_at is null;

create index if not exists facility_invites_facility_idx
  on public.facility_invites (facility_id, created_at desc);

-- Trigger: assert role.facility_id matches invite.facility_id on insert.
-- Mirrors the user_roles facility-match trigger.
create or replace function public.tg_invites_role_facility_match()
returns trigger
language plpgsql
as $$
declare
  r_facility uuid;
begin
  select facility_id into r_facility from public.roles where id = new.role_id;

  if r_facility is null then
    raise exception 'facility_invites: role % does not exist.', new.role_id
      using errcode = '23503';
  end if;

  if r_facility is distinct from new.facility_id then
    raise exception 'facility_invites: role facility (%) does not match invite facility (%).',
      r_facility, new.facility_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists facility_invites_role_facility_match on public.facility_invites;
create trigger facility_invites_role_facility_match
  before insert or update of role_id, facility_id on public.facility_invites
  for each row execute function public.tg_invites_role_facility_match();

alter table public.facility_invites enable row level security;

-- RLS:
--   SELECT: facility admins for own facility; platform admins all
--   INSERT: facility admins for own facility only; facility_id forced via DEFAULT
--   UPDATE: revoke (set revoked_at) by facility admin; accept (set accepted_at) via
--           the service-role accept_invite RPC. No direct client accepts.
--   DELETE: not permitted (revoke, don't delete — preserves audit trail)

drop policy if exists facility_invites_select on public.facility_invites;
create policy facility_invites_select on public.facility_invites
  for select to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  );

drop policy if exists facility_invites_insert on public.facility_invites;
create policy facility_invites_insert on public.facility_invites
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  );

-- Admins can only revoke (set revoked_at). Accepting is service-role-only.
drop policy if exists facility_invites_update on public.facility_invites;
create policy facility_invites_update on public.facility_invites
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

-- No DELETE policy — revocation via revoked_at only.

comment on table public.facility_invites is
  'Invite links. token_hash is SHA-256 hex of the raw token. One-shot, 7-day TTL.';
comment on column public.facility_invites.token_hash is
  'SHA-256 hex of the raw token. Raw token returned once at creation and never stored.';
comment on column public.facility_invites.accepted_at is
  'Set by the service-role accept_invite RPC on successful acceptance. Read-only from client.';
