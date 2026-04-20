-- 20260424000003_impersonation.sql
-- Platform-admin impersonation mechanism.
--
-- Flow:
--   1. /platform-admin/facilities/[id]/impersonate POST sets httpOnly cookies and
--      inserts an impersonation_sessions row.
--   2. Every subsequent authenticated request calls rpc_set_request_vars(...)
--      which calls SET LOCAL on two session variables: app.impersonated_facility_id
--      and app.impersonator_user_id.
--   3. current_facility_id() (Agent 1a) already honors app.impersonated_facility_id
--      IF is_platform_admin() returns true.
--   4. audit_log BEFORE INSERT trigger reads app.impersonator_user_id and auto-
--      populates actor_impersonator_id when present.
--   5. /platform-admin/stop-impersonating POST clears cookies and closes the
--      impersonation_sessions row.

create table if not exists public.impersonation_sessions (
  id                        uuid primary key default gen_random_uuid(),
  platform_admin_user_id    uuid not null references public.users(id) on delete restrict,
  target_facility_id        uuid not null references public.facilities(id) on delete restrict,
  started_at                timestamptz not null default now(),
  ended_at                  timestamptz,
  ended_reason              text check (ended_reason in ('explicit_stop', 'idle_timeout', 'platform_admin_deactivated'))
);

create index if not exists impersonation_sessions_active_idx
  on public.impersonation_sessions (platform_admin_user_id, started_at desc)
  where ended_at is null;

create index if not exists impersonation_sessions_facility_idx
  on public.impersonation_sessions (target_facility_id, started_at desc);

alter table public.impersonation_sessions enable row level security;

-- SELECT: platform admins only (operational + forensic use)
drop policy if exists impersonation_sessions_select on public.impersonation_sessions;
create policy impersonation_sessions_select on public.impersonation_sessions
  for select to authenticated
  using (public.is_platform_admin());

-- INSERT/UPDATE: via rpc_start_impersonation / rpc_stop_impersonation only.
-- No DELETE ever.

create or replace function public.tg_impersonation_sessions_no_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'impersonation_sessions is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists impersonation_sessions_no_delete on public.impersonation_sessions;
create trigger impersonation_sessions_no_delete
  before delete on public.impersonation_sessions
  for each row execute function public.tg_impersonation_sessions_no_delete();

-- ----------------------------------------------------------------------------
-- rpc_set_request_vars — called at the start of every authenticated request
-- during an active impersonation session. Verifies the caller is a platform
-- admin; silently noops otherwise (so a non-privileged request with a forged
-- cookie can't escalate).
-- ----------------------------------------------------------------------------

create or replace function public.rpc_set_request_vars(
  p_impersonated_facility_id uuid,
  p_impersonator_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only platform admins may activate impersonation session vars
  if not public.is_platform_admin() then
    -- Silent noop — caller may have stale cookie without privilege
    return;
  end if;

  -- Verify the nominated impersonator matches the authenticated user
  if p_impersonator_user_id is distinct from auth.uid() then
    raise exception 'rpc_set_request_vars: impersonator_user_id must match auth.uid()'
      using errcode = '42501';
  end if;

  perform set_config('app.impersonated_facility_id', p_impersonated_facility_id::text, true);
  perform set_config('app.impersonator_user_id', p_impersonator_user_id::text, true);
end;
$$;

grant execute on function public.rpc_set_request_vars(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- rpc_start_impersonation + rpc_stop_impersonation
-- ----------------------------------------------------------------------------

create or replace function public.rpc_start_impersonation(
  p_target_facility_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_facility record;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select id, is_platform into v_facility from public.facilities where id = p_target_facility_id;
  if v_facility.id is null then
    raise exception 'target facility not found' using errcode = 'P0002';
  end if;
  if v_facility.is_platform then
    raise exception 'cannot impersonate into the Platform Operations facility'
      using errcode = 'P0001';
  end if;

  -- Close any stale active sessions for this admin (defensive; client should have called stop)
  update public.impersonation_sessions
     set ended_at = now(), ended_reason = 'idle_timeout'
   where platform_admin_user_id = auth.uid()
     and ended_at is null;

  insert into public.impersonation_sessions (platform_admin_user_id, target_facility_id)
  values (auth.uid(), p_target_facility_id)
  returning id into v_id;

  insert into public.audit_log
    (facility_id, actor_user_id, actor_impersonator_id, action, entity_type, entity_id, metadata)
  values (
    p_target_facility_id,
    auth.uid(),
    auth.uid(),  -- they are both here; the subsequent session-var-driven trigger will
                 -- populate for downstream inserts
    'impersonation.started',
    'impersonation_session',
    v_id,
    jsonb_build_object('target_facility_id', p_target_facility_id)
  );

  return v_id;
end;
$$;

grant execute on function public.rpc_start_impersonation(uuid) to authenticated;

create or replace function public.rpc_stop_impersonation()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select id, target_facility_id into v_session
  from public.impersonation_sessions
  where platform_admin_user_id = auth.uid()
    and ended_at is null
  order by started_at desc
  limit 1;

  if v_session.id is null then
    return;
  end if;

  update public.impersonation_sessions
     set ended_at = now(), ended_reason = 'explicit_stop'
   where id = v_session.id;

  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_session.target_facility_id,
    auth.uid(),
    'impersonation.stopped',
    'impersonation_session',
    v_session.id,
    '{}'::jsonb
  );
end;
$$;

grant execute on function public.rpc_stop_impersonation() to authenticated;

-- ----------------------------------------------------------------------------
-- audit_log auto-populate actor_impersonator_id from session var
-- ----------------------------------------------------------------------------

create or replace function public.tg_audit_log_populate_impersonator()
returns trigger
language plpgsql
as $$
declare
  v_imp uuid;
begin
  if new.actor_impersonator_id is null then
    begin
      v_imp := nullif(current_setting('app.impersonator_user_id', true), '')::uuid;
    exception when others then
      v_imp := null;
    end;
    if v_imp is not null then
      new.actor_impersonator_id := v_imp;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_log_populate_impersonator on public.audit_log;
create trigger audit_log_populate_impersonator
  before insert on public.audit_log
  for each row execute function public.tg_audit_log_populate_impersonator();

comment on table public.impersonation_sessions is
  'Append-only record of platform-admin impersonation. Started / stopped by RPCs; audit_log rows during active session auto-tag actor_impersonator_id via trigger.';
