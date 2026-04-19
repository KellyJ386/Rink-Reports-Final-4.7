-- 20260420000007_accept_invite_fn.sql
-- Two functions split around the Supabase Auth admin API call:
--
--   rpc_lookup_invite_by_token(raw_token)
--     Validates the token + returns invite details. Called twice from the TS flow:
--     once when rendering /accept-invite to show "Create your account for Rink Alpha",
--     and again right before completing acceptance to guard against TOCTOU.
--
--   rpc_complete_invite_acceptance(invite_id, auth_user_id, full_name)
--     Called after supabase.auth.admin.createUser succeeds. Atomically:
--       * Insert public.users (facility_id from the invite)
--       * Insert public.user_roles
--       * Mark invite accepted_at
--       * Audit log
--
-- Both run SECURITY DEFINER because the caller is unauthenticated (no auth.uid())
-- during accept-invite. The TS layer protects the endpoint via rate limiting + token
-- validation.

-- ------------------------------------------------------------------
-- rpc_lookup_invite_by_token
-- ------------------------------------------------------------------

create or replace function public.rpc_lookup_invite_by_token(
  p_raw_token text
)
returns table (
  invite_id uuid,
  facility_id uuid,
  facility_name text,
  email citext,
  role_id uuid,
  role_name text,
  state text  -- 'valid' | 'expired' | 'accepted' | 'revoked' | 'not_found'
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token_hash text;
  v_invite record;
  v_state text;
begin
  if p_raw_token is null or length(p_raw_token) < 16 then
    return query select null::uuid, null::uuid, null::text, null::citext, null::uuid, null::text, 'not_found'::text;
    return;
  end if;

  v_token_hash := encode(extensions.digest(p_raw_token, 'sha256'), 'hex');

  select fi.id, fi.facility_id, f.name as facility_name, fi.email,
         fi.role_id, r.name as role_name,
         fi.accepted_at, fi.revoked_at, fi.expires_at
  into v_invite
  from public.facility_invites fi
  join public.facilities f on f.id = fi.facility_id
  join public.roles r on r.id = fi.role_id
  where fi.token_hash = v_token_hash;

  if v_invite.id is null then
    return query select null::uuid, null::uuid, null::text, null::citext, null::uuid, null::text, 'not_found'::text;
    return;
  end if;

  -- State priority: revoked > accepted > expired > valid
  if v_invite.revoked_at is not null then
    v_state := 'revoked';
  elsif v_invite.accepted_at is not null then
    v_state := 'accepted';
  elsif v_invite.expires_at <= now() then
    v_state := 'expired';
  else
    v_state := 'valid';
  end if;

  return query select
    v_invite.id,
    v_invite.facility_id,
    v_invite.facility_name,
    v_invite.email,
    v_invite.role_id,
    v_invite.role_name,
    v_state;
end;
$$;

grant execute on function public.rpc_lookup_invite_by_token(text) to anon, authenticated;

comment on function public.rpc_lookup_invite_by_token(text) is
  'Unauthenticated: look up an invite by raw token. Returns state ∈ {valid, expired, accepted, revoked, not_found}. Does not reveal whether a hash exists for wrong/short inputs (returns not_found).';

-- ------------------------------------------------------------------
-- rpc_complete_invite_acceptance
-- ------------------------------------------------------------------

create or replace function public.rpc_complete_invite_acceptance(
  p_invite_id uuid,
  p_auth_user_id uuid,
  p_full_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
begin
  -- Re-validate the invite under row lock (TOCTOU guard)
  select id, facility_id, email, role_id, accepted_at, revoked_at, expires_at
  into v_invite
  from public.facility_invites
  where id = p_invite_id
  for update;

  if v_invite.id is null then
    raise exception 'invite % not found', p_invite_id using errcode = 'P0002';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'invite is revoked' using errcode = 'P0001';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'invite is already accepted' using errcode = 'P0001';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invite is expired' using errcode = 'P0001';
  end if;

  -- Insert the profile row (facility_id immutable via trigger after this)
  insert into public.users (id, facility_id, full_name, email, active)
  values (p_auth_user_id, v_invite.facility_id, p_full_name, v_invite.email, true);

  -- Assign the role
  insert into public.user_roles (user_id, role_id, assigned_by)
  values (p_auth_user_id, v_invite.role_id, v_invite.invited_by_fallback());
  -- ^ invited_by_fallback is just v_invite.invited_by; inlined below
  -- (Note: pgTAP doesn't support method-call syntax; using the raw column)

  -- Consume the token
  update public.facility_invites
    set accepted_at = now()
    where id = v_invite.id;

  -- Audit
  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_invite.facility_id,
    p_auth_user_id,
    'invite.accepted',
    'user',
    p_auth_user_id,
    jsonb_build_object('invite_id', p_invite_id, 'email', v_invite.email::text)
  );
end;
$$;

-- Redefine cleanly (the "method call" above is invalid; correcting)
create or replace function public.rpc_complete_invite_acceptance(
  p_invite_id uuid,
  p_auth_user_id uuid,
  p_full_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
begin
  select id, facility_id, email, role_id, invited_by,
         accepted_at, revoked_at, expires_at
  into v_invite
  from public.facility_invites
  where id = p_invite_id
  for update;

  if v_invite.id is null then
    raise exception 'invite % not found', p_invite_id using errcode = 'P0002';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'invite is revoked' using errcode = 'P0001';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'invite is already accepted' using errcode = 'P0001';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invite is expired' using errcode = 'P0001';
  end if;

  -- Insert the profile row
  insert into public.users (id, facility_id, full_name, email, active)
  values (p_auth_user_id, v_invite.facility_id, p_full_name, v_invite.email, true);

  -- Assign the role. The user_roles facility-match trigger verifies consistency
  -- (user.facility_id = role.facility_id). Since we just inserted the user with
  -- facility_id = invite.facility_id and the invite trigger guaranteed role.facility_id
  -- matches invite.facility_id, this always succeeds.
  insert into public.user_roles (user_id, role_id, assigned_by)
  values (p_auth_user_id, v_invite.role_id, v_invite.invited_by);

  -- Consume the token
  update public.facility_invites
    set accepted_at = now()
    where id = v_invite.id;

  -- Audit
  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_invite.facility_id,
    p_auth_user_id,
    'invite.accepted',
    'user',
    p_auth_user_id,
    jsonb_build_object('invite_id', p_invite_id, 'email', v_invite.email::text)
  );
end;
$$;

grant execute on function public.rpc_complete_invite_acceptance(uuid, uuid, text) to authenticated;

comment on function public.rpc_complete_invite_acceptance(uuid, uuid, text) is
  'Called by the service-role accept-invite flow AFTER supabase.auth.admin.createUser has created the auth.users row. Atomically: inserts public.users, assigns the role, marks the invite accepted, writes audit_log.';

-- ------------------------------------------------------------------
-- rpc_revoke_invite
-- ------------------------------------------------------------------

create or replace function public.rpc_revoke_invite(
  p_invite_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
begin
  select id, facility_id, accepted_at, revoked_at
  into v_invite
  from public.facility_invites
  where id = p_invite_id
  for update;

  if v_invite.id is null then
    raise exception 'invite % not found', p_invite_id using errcode = 'P0002';
  end if;

  -- AuthZ: platform admin OR facility admin for the invite's facility
  if not (
    public.is_platform_admin()
    or (
      v_invite.facility_id = public.current_facility_id()
      and public.has_module_access('admin_control_center', 'admin')
    )
  ) then
    raise exception 'not authorized to revoke this invite' using errcode = '42501';
  end if;

  if v_invite.accepted_at is not null then
    raise exception 'cannot revoke an already-accepted invite' using errcode = 'P0001';
  end if;
  if v_invite.revoked_at is not null then
    return;  -- idempotent: already revoked
  end if;

  update public.facility_invites
    set revoked_at = now()
    where id = p_invite_id;

  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_invite.facility_id,
    auth.uid(),
    'invite.revoked',
    'invite',
    p_invite_id,
    '{}'::jsonb
  );
end;
$$;

grant execute on function public.rpc_revoke_invite(uuid) to authenticated;
