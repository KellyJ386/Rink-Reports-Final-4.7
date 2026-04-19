-- supabase/tests/06_facility_resources.test.sql
-- facility_resources: tenant isolation + admin-only writes.

begin;
select plan(10);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- Seed a resource at alpha as the alpha admin
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select lives_ok(
  $$insert into public.facility_resources (resource_type, name, sort_order)
    values ('surface', 'Main Sheet', 1)$$,
  'alpha admin can create a surface resource'
);

-- Alpha staff can SELECT resources (needed for option pickers)
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);
select cmp_ok(
  (select count(*)::int from public.facility_resources
   where resource_type = 'surface'),
  '>=',
  1,
  'alpha staff can SELECT alpha surfaces'
);

-- Alpha staff CANNOT INSERT resources (requires admin on admin_control_center)
select throws_ok(
  $$insert into public.facility_resources (resource_type, name)
    values ('surface', 'Unauthorized Sheet')$$,
  null,
  'alpha staff cannot insert resources'
);

-- Beta users cannot see alpha surfaces
select _test_as('00000002-0000-0000-0000-000000002003'::uuid);
select is(
  (select count(*)::int from public.facility_resources
   where name = 'Main Sheet'),
  0,
  'beta staff cannot see alpha surfaces'
);

-- Beta admin cannot INSERT with forged facility_id
select _test_as('00000002-0000-0000-0000-000000002001'::uuid);
select throws_ok(
  $$insert into public.facility_resources (facility_id, resource_type, name)
    values ('00000001-0000-0000-0000-000000000001', 'surface', 'Forged Sheet')$$,
  null,
  'beta admin cannot forge alpha facility_id in INSERT'
);

-- Beta admin INSERT with own facility_id succeeds (default column)
select lives_ok(
  $$insert into public.facility_resources (resource_type, name)
    values ('compressor', 'Beta Compressor 1')$$,
  'beta admin can insert a resource in own facility'
);

-- Alpha admin UPDATE of beta resource → 0 rows affected (RLS filter)
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
with upd as (
  update public.facility_resources set name = 'Hacked'
  where name = 'Beta Compressor 1'
  returning id
)
select is((select count(*)::int from upd), 0, 'alpha admin UPDATE of beta resource affects 0 rows');

-- Platform admin sees resources across facilities
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select cmp_ok(
  (select count(distinct facility_id)::int from public.facility_resources),
  '>=',
  2,
  'platform admin sees resources from both seeded facilities'
);

-- Deactivation: alpha admin deactivates the surface; it's still readable (history)
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select lives_ok(
  $$update public.facility_resources set is_active = false
    where resource_type = 'surface' and name = 'Main Sheet'$$,
  'alpha admin can deactivate a resource'
);

-- Deactivated resources still SELECT-able (for history); pickers filter is_active=true in app code
select is(
  (select count(*)::int from public.facility_resources
   where resource_type = 'surface' and is_active = false and name = 'Main Sheet'),
  1,
  'deactivated resource still readable'
);

select * from finish();
rollback;
