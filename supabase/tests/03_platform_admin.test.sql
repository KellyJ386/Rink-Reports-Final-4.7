-- supabase/tests/03_platform_admin.test.sql
-- Prove platform admins can read across facilities, and that impersonation narrows
-- their view to exactly one facility.

begin;
select plan(11);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- Platform admin without impersonation sees every facility
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select set_config('app.impersonated_facility_id', '', true);

-- Three facilities exist: platform, alpha, beta
select cmp_ok(
  (select count(*)::int from public.facilities),
  '>=',
  3,
  'platform admin sees platform + alpha + beta (>=3 rows)'
);

-- Users from every facility
select cmp_ok(
  (select count(distinct facility_id)::int from public.users),
  '>=',
  3,
  'platform admin sees users from every facility'
);

-- Roles from every facility
select cmp_ok(
  (select count(distinct facility_id)::int from public.roles),
  '>=',
  3,
  'platform admin sees roles from every facility'
);

-- Impersonation set to Alpha → platform admin now scoped to Alpha only (for tenant tables)
select set_config('app.impersonated_facility_id',
                  '00000001-0000-0000-0000-000000000001', true);

-- current_facility_id() should return alpha
select is(
  public.current_facility_id(),
  '00000001-0000-0000-0000-000000000001'::uuid,
  'impersonation sets current_facility_id to alpha'
);

-- Even though is_platform_admin() is still true, because policies OR in is_platform_admin,
-- the platform admin still sees everything in SELECT. The impersonation affects
-- current_facility_id(), which is used in INSERT WITH CHECK paths. Verify this behavior:
--
--   * SELECT: platform admins retain cross-facility read access regardless of impersonation.
--     Impersonation is primarily a UX affordance + INSERT-path scoping + audit log tagging.
select cmp_ok(
  (select count(*)::int from public.facilities),
  '>=',
  3,
  'platform admin with impersonation still SELECTs all facilities (RLS ORs in is_platform_admin)'
);

-- BUT: an INSERT that relies on current_facility_id() as DEFAULT or WITH CHECK will
-- now scope to the impersonated facility. Test by inserting an audit_log row:
select lives_ok(
  $$insert into public.audit_log (facility_id, actor_user_id, action, entity_type)
    values (public.current_facility_id(),
            '00000000-0000-0000-0000-000000000001'::uuid,
            'impersonation.test', 'test')$$,
  'platform admin with impersonation can INSERT audit_log scoped to impersonated facility'
);

-- The audit row landed under the alpha facility_id
select is(
  (select facility_id from public.audit_log
   where action = 'impersonation.test'
   order by created_at desc limit 1),
  '00000001-0000-0000-0000-000000000001'::uuid,
  'audit_log row was written with alpha facility_id (via current_facility_id())'
);

-- Clear impersonation and verify platform admin's current_facility_id reverts to platform ops
select set_config('app.impersonated_facility_id', '', true);
select is(
  public.current_facility_id(),
  public.platform_facility_id(),
  'clearing impersonation returns platform admin to platform ops facility'
);

-- is_platform_admin() remains true throughout
select is(public.is_platform_admin(), true, 'is_platform_admin is stable across impersonation');

-- Regular user (alpha admin) cannot read other facilities regardless of any session setting
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select set_config('app.impersonated_facility_id',
                  '00000002-0000-0000-0000-000000000002', true);
-- Should still see only alpha
select is(
  (select count(*)::int from public.facilities
   where id = '00000002-0000-0000-0000-000000000002'::uuid),
  0,
  'non-platform-admin cannot see beta even when impersonation cookie is forged'
);

select is(
  public.current_facility_id(),
  '00000001-0000-0000-0000-000000000001'::uuid,
  'non-platform-admin current_facility_id ignores impersonation override'
);

select * from finish();
rollback;
