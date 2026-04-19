-- supabase/tests/10_facility_subscriptions.test.sql
-- facility_subscriptions: read-only for facility admins, no writes from authenticated.

begin;
select plan(6);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- Seed rows for the test facilities (the test facilities don't have subscription rows
-- from Agent 1a's seed.sql; they were created before Agent 1b landed the subscription
-- schema. Insert rows for them now as the platform admin / service role equivalent).
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select lives_ok(
  $$insert into public.facility_subscriptions
      (facility_id, status, plan_tier, trial_end)
    values
      ('00000001-0000-0000-0000-000000000001', 'trialing', 'trial', now() + interval '30 days'),
      ('00000002-0000-0000-0000-000000000002', 'trialing', 'trial', now() + interval '30 days')
    on conflict (facility_id) do nothing$$,
  'seed subscription rows for test facilities'
);

-- Alpha admin can SELECT their own subscription
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select is(
  (select status from public.facility_subscriptions
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid),
  'trialing',
  'alpha admin can SELECT own subscription'
);

-- Alpha staff cannot SELECT subscriptions (requires read on admin_control_center)
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);
select is(
  (select count(*)::int from public.facility_subscriptions),
  0,
  'alpha staff cannot SELECT subscriptions'
);

-- Alpha admin cannot see beta's subscription
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select is(
  (select count(*)::int from public.facility_subscriptions
   where facility_id = '00000002-0000-0000-0000-000000000002'::uuid),
  0,
  'alpha admin cannot see beta subscription'
);

-- Authenticated users cannot INSERT subscriptions
select throws_ok(
  $$insert into public.facility_subscriptions
      (facility_id, status, plan_tier)
    values ('00000001-0000-0000-0000-000000000001', 'active', 'single_facility')
    on conflict (facility_id) do update set status = 'active'$$,
  null,
  'authenticated users cannot INSERT/UPDATE subscriptions (service-role-only)'
);

-- Authenticated users cannot UPDATE subscriptions
select throws_ok(
  $$update public.facility_subscriptions set status = 'canceled'
    where facility_id = '00000001-0000-0000-0000-000000000001'::uuid$$,
  null,
  'authenticated users cannot UPDATE subscription status'
);

select * from finish();
rollback;
