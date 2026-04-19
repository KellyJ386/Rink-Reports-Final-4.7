-- supabase/tests/01_helper_functions.test.sql
-- Verify the four RLS helper functions behave as documented.

begin;
select plan(16);

-- Helper: set JWT claims to act as a specific user
create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

create or replace function _test_as_anon() returns void
language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '', true);
$$;

-- ----------------------------------------------------------------
-- platform_facility_id()
-- ----------------------------------------------------------------

-- 1. Returns a single non-null UUID
select isnt(public.platform_facility_id(), null, 'platform_facility_id returns a UUID');

-- 2. That UUID matches the row with is_platform = true
select is(
  (select public.platform_facility_id()),
  (select id from public.facilities where is_platform = true),
  'platform_facility_id matches the is_platform row'
);

-- ----------------------------------------------------------------
-- is_platform_admin()
-- ----------------------------------------------------------------

-- 3. Anonymous → false
select _test_as_anon();
select is(public.is_platform_admin(), false, 'anon is not platform admin');

-- 4. Regular user (alpha admin) → false
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select is(public.is_platform_admin(), false, 'facility admin is not platform admin');

-- 5. Actual platform admin → true
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select is(public.is_platform_admin(), true, 'platform admin is platform admin');

-- ----------------------------------------------------------------
-- current_facility_id()
-- ----------------------------------------------------------------

-- 6. Alpha admin → Alpha facility
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select is(
  public.current_facility_id(),
  '00000001-0000-0000-0000-000000000001'::uuid,
  'alpha admin current_facility_id = alpha'
);

-- 7. Beta admin → Beta facility
select _test_as('00000002-0000-0000-0000-000000002001'::uuid);
select is(
  public.current_facility_id(),
  '00000002-0000-0000-0000-000000000002'::uuid,
  'beta admin current_facility_id = beta'
);

-- 8. Platform admin (no impersonation) → Platform Operations facility
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select is(
  public.current_facility_id(),
  public.platform_facility_id(),
  'platform admin current_facility_id = platform ops (no impersonation)'
);

-- 9. Platform admin WITH impersonation set to alpha → alpha
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select set_config('app.impersonated_facility_id',
                  '00000001-0000-0000-0000-000000000001', true);
select is(
  public.current_facility_id(),
  '00000001-0000-0000-0000-000000000001'::uuid,
  'platform admin with impersonation returns impersonated facility'
);

-- 10. Non-platform-admin user with impersonation set → their own facility, NOT impersonated
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);  -- alpha admin
select set_config('app.impersonated_facility_id',
                  '00000002-0000-0000-0000-000000000002', true);  -- try to impersonate beta
select is(
  public.current_facility_id(),
  '00000001-0000-0000-0000-000000000001'::uuid,
  'non-platform-admin cannot impersonate — returns own facility'
);

-- Clear impersonation and reset state
select set_config('app.impersonated_facility_id', '', true);

-- ----------------------------------------------------------------
-- has_module_access(slug, level)
-- ----------------------------------------------------------------

-- Alpha admin has admin on admin_control_center
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select is(public.has_module_access('admin_control_center', 'admin'),  true,  'alpha admin has admin on ACC');
select is(public.has_module_access('admin_control_center', 'write'),  true,  'alpha admin has write on ACC (admin>=write)');
select is(public.has_module_access('admin_control_center', 'read'),   true,  'alpha admin has read on ACC');

-- Alpha staff has none on admin_control_center
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);
select is(public.has_module_access('admin_control_center', 'read'),   false, 'alpha staff does NOT have read on ACC');
select is(public.has_module_access('admin_control_center', 'write'),  false, 'alpha staff does NOT have write on ACC');

-- Alpha staff has write on ice_maintenance
select is(public.has_module_access('ice_maintenance', 'write'),       true,  'alpha staff has write on ice_maintenance');

-- Alpha staff has read on communications (per seed)
select is(public.has_module_access('communications', 'read'),         true,  'alpha staff has read on communications');

select * from finish();
rollback;
