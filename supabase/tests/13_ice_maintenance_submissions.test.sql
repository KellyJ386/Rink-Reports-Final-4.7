-- supabase/tests/13_ice_maintenance_submissions.test.sql
-- ice_maintenance_submissions: RLS, idempotency (partial unique), form_type check,
-- cross-facility isolation.

begin;
select plan(10);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- Pick a known surface in alpha (from seed: Main Rink, id unknown but queryable)
-- Alpha staff submits a circle_check (has write on ice_maintenance per seed)
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);

select lives_ok(
  $$insert into public.ice_maintenance_submissions
      (submitted_by, form_type, form_schema_version, surface_resource_id, custom_fields, idempotency_key)
    select
      '00000001-0000-0000-0000-000000001003',
      'circle_check',
      1,
      (select id from public.facility_resources
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and resource_type = 'surface' and name = 'Main Rink' limit 1),
      '{"ice_condition":"good","glass_condition":"intact","doors_clear":true,"nets_intact":true}'::jsonb,
      'idem-test-key-0001'$$,
  'alpha staff can submit a circle_check'
);

-- Duplicate idempotency_key → rejected by partial unique
select throws_ok(
  $$insert into public.ice_maintenance_submissions
      (submitted_by, form_type, form_schema_version, surface_resource_id, custom_fields, idempotency_key)
    select
      '00000001-0000-0000-0000-000000001003',
      'circle_check',
      1,
      (select id from public.facility_resources
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and resource_type = 'surface' and name = 'Main Rink' limit 1),
      '{}'::jsonb,
      'idem-test-key-0001'$$,
  '23505',  -- unique violation
  'duplicate idempotency_key rejected'
);

-- Null idempotency_key: multiple nulls allowed (partial index)
select lives_ok(
  $$insert into public.ice_maintenance_submissions
      (submitted_by, form_type, form_schema_version, surface_resource_id, custom_fields)
    select
      '00000001-0000-0000-0000-000000001003',
      'circle_check',
      1,
      (select id from public.facility_resources
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and resource_type = 'surface' and name = 'Main Rink' limit 1),
      '{"ice_condition":"fair","glass_condition":"intact","doors_clear":true,"nets_intact":true}'::jsonb$$,
  'null idempotency_key allows multiple'
);

-- Form type check: bad form_type rejected
select throws_ok(
  $$insert into public.ice_maintenance_submissions
      (submitted_by, form_type, form_schema_version, surface_resource_id)
    select
      '00000001-0000-0000-0000-000000001003',
      'bogus_form_type',
      1,
      (select id from public.facility_resources
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and resource_type = 'surface' and name = 'Main Rink' limit 1)$$,
  null,
  'check constraint rejects unknown form_type'
);

-- Alpha admin sees alpha submissions
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select cmp_ok(
  (select count(*)::int from public.ice_maintenance_submissions
   where form_type = 'circle_check'),
  '>=',
  2,
  'alpha admin sees alpha circle_check submissions'
);

-- Beta user CANNOT see alpha submissions
select _test_as('00000002-0000-0000-0000-000000002001'::uuid);
select is(
  (select count(*)::int from public.ice_maintenance_submissions
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid),
  0,
  'beta admin does not see alpha submissions'
);

-- Beta user cannot forge alpha facility_id on insert
select throws_ok(
  $$insert into public.ice_maintenance_submissions
      (facility_id, submitted_by, form_type, form_schema_version, surface_resource_id)
    values (
      '00000001-0000-0000-0000-000000000001',
      '00000002-0000-0000-0000-000000002001',
      'circle_check',
      1,
      (select id from public.facility_resources
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and resource_type = 'surface' limit 1)
    )$$,
  null,
  'beta admin cannot forge alpha facility_id'
);

-- Beta admin inserts into beta (valid)
select lives_ok(
  $$insert into public.ice_maintenance_submissions
      (submitted_by, form_type, form_schema_version, surface_resource_id, custom_fields)
    select
      '00000002-0000-0000-0000-000000002001',
      'circle_check',
      1,
      (select id from public.facility_resources
       where facility_id = '00000002-0000-0000-0000-000000000002'::uuid
         and resource_type = 'surface' limit 1),
      '{}'::jsonb$$,
  'beta admin can submit in own facility'
);

-- Alpha user without module access: revoke ice_maintenance access for a role then try
-- Alpha staff still has access per seed, so we simulate by flipping role access
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select lives_ok(
  $$update public.role_module_access
    set access_level = 'none'
    where role_id = '00000001-1000-0000-0000-000000000003'::uuid
      and module_id = (select id from public.modules where slug = 'ice_maintenance')$$,
  'platform admin revokes ice_maintenance access for alpha Staff role'
);

-- Now alpha staff cannot submit
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);
select throws_ok(
  $$insert into public.ice_maintenance_submissions
      (submitted_by, form_type, form_schema_version, surface_resource_id)
    select
      '00000001-0000-0000-0000-000000001003',
      'circle_check',
      1,
      (select id from public.facility_resources
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and resource_type = 'surface' limit 1)$$,
  null,
  'alpha staff without ice_maintenance write access cannot submit'
);

select * from finish();
rollback;
