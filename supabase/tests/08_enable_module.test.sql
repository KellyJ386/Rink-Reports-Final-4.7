-- supabase/tests/08_enable_module.test.sql
-- rpc_enable_module(): AuthZ, facility_modules flip, audit trail, form_schemas
-- guard (no-op in Phase 1).

begin;
select plan(9);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- First disable a module so we have something to enable
-- (seed enables all 9 for both facilities)
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select lives_ok(
  $$update public.facility_modules set is_enabled = false
    where facility_id = '00000001-0000-0000-0000-000000000001'
      and module_id = (select id from public.modules where slug = 'air_quality')$$,
  'pre-disable air_quality for alpha as platform admin'
);

-- Alpha admin re-enables via rpc_enable_module
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select lives_ok(
  $$select public.rpc_enable_module('00000001-0000-0000-0000-000000000001', 'air_quality')$$,
  'alpha admin can enable a module in own facility'
);

-- Confirm the flip
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select is(
  (select is_enabled from public.facility_modules
   where facility_id = '00000001-0000-0000-0000-000000000001'
     and module_id = (select id from public.modules where slug = 'air_quality')),
  true,
  'air_quality is now enabled for alpha'
);

-- Audit row exists
select cmp_ok(
  (select count(*)::int from public.audit_log
   where action = 'module.enabled'
     and facility_id = '00000001-0000-0000-0000-000000000001'
     and metadata->>'module_slug' = 'air_quality'),
  '>=',
  1,
  'audit_log captured module.enabled for alpha air_quality'
);

-- Alpha staff CANNOT call rpc_enable_module (requires admin)
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);
select throws_ok(
  $$select public.rpc_enable_module('00000001-0000-0000-0000-000000000001', 'incident')$$,
  null,
  'alpha staff cannot call rpc_enable_module'
);

-- Alpha admin cannot enable a module in beta (cross-facility)
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select throws_ok(
  $$select public.rpc_enable_module('00000002-0000-0000-0000-000000000002', 'refrigeration')$$,
  null,
  'alpha admin cannot enable modules in beta'
);

-- Platform admin can enable across facilities
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select lives_ok(
  $$select public.rpc_enable_module('00000002-0000-0000-0000-000000000002', 'refrigeration')$$,
  'platform admin can enable module cross-facility'
);

-- Unknown module slug raises
select throws_ok(
  $$select public.rpc_enable_module('00000001-0000-0000-0000-000000000001', 'nonexistent_module')$$,
  null,
  'unknown module slug raises'
);

-- form_schemas guard: in Phase 1 the table does not exist, so enableModule's seeding
-- step is a no-op. Verify by checking metadata.seeded_defaults = false.
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select is(
  (select metadata->>'seeded_defaults' from public.audit_log
   where action = 'module.enabled'
     and facility_id = '00000002-0000-0000-0000-000000000002'
     and metadata->>'module_slug' = 'refrigeration'
   order by created_at desc limit 1),
  'false',
  'enableModule sets seeded_defaults=false in Phase 1 (form_schemas not shipped yet)'
);

select * from finish();
rollback;
