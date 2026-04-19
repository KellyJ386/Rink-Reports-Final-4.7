-- 20260420000006_create_facility_fn.sql
-- The rpc_create_facility_with_first_admin() function. Platform-admin-only.
--
-- Single atomic transaction:
--   1. Insert facilities
--   2. Insert facility_subscriptions (trialing, 30d)
--   3. Insert Admin role (is_system = true)
--   4. Enable every module in the default bundle (= all modules) via rpc_enable_module()
--   5. Assign Admin role 'admin' access to every enabled module
--   6. Generate a random 32-byte token, hash it, insert facility_invites row
--   7. Write audit_log
--
-- Returns (facility_id, raw_invite_token). The TS wrapper formats the invite URL and
-- sends the email (Supabase built-in SMTP in v1; Resend via Agent 7 later).

create or replace function public.rpc_create_facility_with_first_admin(
  p_name text,
  p_timezone text,
  p_address jsonb,
  p_first_admin_email citext,
  p_slug text default null
)
returns table (
  facility_id uuid,
  invite_token text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_facility_id uuid;
  v_role_id uuid;
  v_slug text;
  v_raw_token text;
  v_token_hash text;
  v_module record;
begin
  -- AuthZ: platform admin only
  if not public.is_platform_admin() then
    raise exception 'rpc_create_facility_with_first_admin: not authorized (platform admin required)'
      using errcode = '42501';
  end if;

  -- Validate email shape minimally (full validation in TS layer)
  if p_first_admin_email is null or length(trim(p_first_admin_email::text)) < 3 then
    raise exception 'first admin email is required' using errcode = '22023';
  end if;

  -- Derive slug from name if not provided
  v_slug := lower(regexp_replace(
    coalesce(p_slug, p_name),
    '[^a-zA-Z0-9]+', '-', 'g'
  ));
  v_slug := trim(both '-' from v_slug);
  v_slug := substring(v_slug from 1 for 60);
  if length(v_slug) = 0 then
    raise exception 'computed slug is empty; provide p_slug explicitly' using errcode = '22023';
  end if;

  -- 1. Facility
  insert into public.facilities (slug, name, timezone, address, plan_tier, is_platform)
  values (v_slug, p_name, p_timezone, p_address, 'trial', false)
  returning id into v_facility_id;

  -- 2. Subscription (trialing 30d)
  insert into public.facility_subscriptions
    (facility_id, status, plan_tier, trial_end)
  values
    (v_facility_id, 'trialing', 'trial', now() + interval '30 days');

  -- 3. Admin role
  insert into public.roles (facility_id, name, description, is_system)
  values (v_facility_id, 'Admin', 'Facility administrator', true)
  returning id into v_role_id;

  -- 4 + 5. Enable every module + give Admin role 'admin' on each
  for v_module in select id, slug from public.modules loop
    perform public.rpc_enable_module(v_facility_id, v_module.slug);

    insert into public.role_module_access (role_id, module_id, access_level)
    values (v_role_id, v_module.id, 'admin')
    on conflict (role_id, module_id) do update set access_level = 'admin';
  end loop;

  -- 6. Generate invite token (32 random bytes → base64url), store SHA-256 hex
  v_raw_token := replace(replace(replace(
    encode(extensions.gen_random_bytes(32), 'base64'),
    '+', '-'), '/', '_'), '=', '');
  v_token_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');

  insert into public.facility_invites
    (facility_id, email, role_id, invited_by, token_hash, expires_at)
  values (
    v_facility_id,
    p_first_admin_email,
    v_role_id,
    auth.uid(),
    v_token_hash,
    now() + interval '7 days'
  );

  -- 7. Audit
  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_facility_id,
    auth.uid(),
    'facility.created',
    'facility',
    v_facility_id,
    jsonb_build_object(
      'slug', v_slug,
      'name', p_name,
      'first_admin_email', p_first_admin_email::text,
      'plan_tier', 'trial'
    )
  );

  return query select v_facility_id, v_raw_token;
end;
$$;

grant execute on function public.rpc_create_facility_with_first_admin(text, text, jsonb, citext, text)
  to authenticated;

comment on function public.rpc_create_facility_with_first_admin(text, text, jsonb, citext, text) is
  'Platform-admin-only. Creates a facility + trialing subscription + Admin role + enables all modules + issues first-admin invite. Returns (facility_id, raw_token).';
