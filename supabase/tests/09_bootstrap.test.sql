-- supabase/tests/09_bootstrap.test.sql
-- rpc_create_facility_with_first_admin: end-to-end bootstrap as platform admin.

begin;
select plan(10);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- Regular user cannot call the RPC
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select throws_ok(
  $$select * from public.rpc_create_facility_with_first_admin(
      'Rink Gamma',
      'America/Toronto',
      '{"street":"3 Gamma Rd","city":"Toronto","state":"ON","postal_code":"M5V 3B1"}'::jsonb,
      'admin@gamma.test'::citext,
      null
    )$$,
  null,
  'non-platform-admin cannot call rpc_create_facility_with_first_admin'
);

-- Platform admin can
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);

-- Capture results into a temporary session variable so we can make multiple
-- assertions against the created facility
create temporary table _bootstrap_result on commit drop as
  select * from public.rpc_create_facility_with_first_admin(
    'Rink Gamma',
    'America/Toronto',
    '{"street":"3 Gamma Rd","city":"Toronto","state":"ON","postal_code":"M5V 3B1"}'::jsonb,
    'admin@gamma.test'::citext,
    null
  );

select is(
  (select count(*)::int from _bootstrap_result),
  1,
  'platform admin created a facility + invite'
);

-- Facility row exists with trial plan, non-platform flag, auto-derived slug
select is(
  (select plan_tier from public.facilities
   where id = (select facility_id from _bootstrap_result)),
  'trial',
  'new facility starts on trial plan'
);

select is(
  (select slug from public.facilities
   where id = (select facility_id from _bootstrap_result)),
  'rink-gamma',
  'slug auto-derived from name: "rink-gamma"'
);

-- Subscription row created with trialing status
select is(
  (select status from public.facility_subscriptions
   where facility_id = (select facility_id from _bootstrap_result)),
  'trialing',
  'facility_subscriptions row created with trialing status'
);

-- trial_end is ~30 days out
select cmp_ok(
  (select extract(day from trial_end - now())::int
   from public.facility_subscriptions
   where facility_id = (select facility_id from _bootstrap_result)),
  '>=',
  29,
  'trial_end is at least 29 days in the future'
);

-- Admin role exists, is_system = true
select is(
  (select (name, is_system)::text from public.roles
   where facility_id = (select facility_id from _bootstrap_result)
     and name = 'Admin'),
  '(Admin,t)'::text,
  'Admin role created with is_system=true'
);

-- All 9 modules enabled for the new facility
select is(
  (select count(*)::int from public.facility_modules fm
   where fm.facility_id = (select facility_id from _bootstrap_result)
     and fm.is_enabled = true),
  (select count(*)::int from public.modules),
  'all modules enabled for new facility'
);

-- Admin role has admin on every enabled module
select is(
  (select count(*)::int from public.role_module_access rma
   join public.roles r on r.id = rma.role_id
   where r.facility_id = (select facility_id from _bootstrap_result)
     and r.name = 'Admin'
     and rma.access_level = 'admin'),
  (select count(*)::int from public.modules),
  'Admin role granted admin on every module'
);

-- Exactly one outstanding invite for the new facility, 7-day TTL
select is(
  (select count(*)::int from public.facility_invites
   where facility_id = (select facility_id from _bootstrap_result)
     and accepted_at is null and revoked_at is null),
  1,
  'exactly one outstanding invite for new facility'
);

-- Audit row for facility.created exists
select cmp_ok(
  (select count(*)::int from public.audit_log
   where facility_id = (select facility_id from _bootstrap_result)
     and action = 'facility.created'),
  '>=',
  1,
  'audit_log captured facility.created'
);

select * from finish();
rollback;
