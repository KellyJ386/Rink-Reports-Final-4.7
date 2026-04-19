-- 20260419000008_helper_functions.sql
-- The four RLS helper functions. Read-only, SECURITY DEFINER so they can query their
-- reference tables (users, platform_admins, role_module_access) regardless of the
-- caller's own policies.
--
-- All are STABLE so Postgres caches per-statement.

-- is_platform_admin() -------------------------------------------------------
-- Returns true iff the current authenticated user appears in platform_admins.
-- Used as the escape hatch in every tenant-scoped RLS policy.

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins where user_id = auth.uid()
  );
$$;

comment on function public.is_platform_admin() is
  'True if auth.uid() is a platform admin. The only escape hatch from tenant isolation.';

-- platform_facility_id() ---------------------------------------------------
-- Returns the UUID of the single Platform Operations facility. Never hardcode the
-- UUID anywhere in code, migrations, or tests. Reference this function instead.

create or replace function public.platform_facility_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.facilities where is_platform = true limit 1;
$$;

comment on function public.platform_facility_id() is
  'UUID of the single is_platform = true facility. Never hardcode the UUID; call this function.';

-- current_facility_id() ----------------------------------------------------
-- Returns the facility_id the caller is currently acting on, honoring platform-admin
-- impersonation.
--
-- Flow:
--   1. Read the session-local override `app.impersonated_facility_id` (set via
--      `SET LOCAL app.impersonated_facility_id = '<uuid>'` at transaction start by
--      Agent 7's platform-admin shell).
--   2. If set AND the caller is a platform admin → return the override.
--   3. Otherwise → return the users.facility_id for auth.uid().
--   4. For an unauthenticated caller or a user with no profile row → null.
--      Every RLS policy compares `= current_facility_id()`, so null fails closed.

create or replace function public.current_facility_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  impersonated uuid;
begin
  begin
    impersonated := nullif(
      current_setting('app.impersonated_facility_id', true),
      ''
    )::uuid;
  exception when others then
    impersonated := null;
  end;

  if impersonated is not null and public.is_platform_admin() then
    return impersonated;
  end if;

  return (select facility_id from public.users where id = auth.uid());
end;
$$;

comment on function public.current_facility_id() is
  'Tenant key for the current request. Honors `app.impersonated_facility_id` session variable for platform admins. Null fails closed.';

-- has_module_access(module_slug, required_level) ---------------------------
-- Returns true if auth.uid() has at least `required_level` on the module identified by
-- `module_slug`. Access level ordering: none(0) < read(1) < write(2) < admin(3).
-- Computes the MAX across all the user's roles.

create or replace function public.has_module_access(
  p_module_slug text,
  p_required_level text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  required_ord int;
  actual_ord int;
begin
  required_ord := case p_required_level
    when 'none' then 0
    when 'read' then 1
    when 'write' then 2
    when 'admin' then 3
    else -1
  end;

  if required_ord < 0 then
    return false;
  end if;

  select coalesce(max(case rma.access_level
    when 'none' then 0
    when 'read' then 1
    when 'write' then 2
    when 'admin' then 3
    else 0
  end), 0)
  into actual_ord
  from public.user_roles ur
  join public.role_module_access rma on rma.role_id = ur.role_id
  join public.modules m on m.id = rma.module_id
  where ur.user_id = auth.uid()
    and m.slug = p_module_slug;

  return actual_ord >= required_ord;
end;
$$;

comment on function public.has_module_access(text, text) is
  'True if auth.uid() has at least the required level on the named module. Levels: none<read<write<admin.';

-- Grant usage to authenticated role. These are SECURITY DEFINER so execution is
-- inherent; we still GRANT for clarity.
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.platform_facility_id() to authenticated;
grant execute on function public.current_facility_id() to authenticated;
grant execute on function public.has_module_access(text, text) to authenticated;
