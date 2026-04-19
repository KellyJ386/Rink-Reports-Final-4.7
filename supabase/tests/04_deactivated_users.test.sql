-- supabase/tests/04_deactivated_users.test.sql
-- DB-level tests for the deactivated user flag. Middleware enforcement is a
-- TypeScript/integration-test concern (Agent 9 owns that harness via Playwright);
-- here we verify the schema + seed data support the expected behavior.

begin;
select plan(5);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- The deactivated alpha user exists and is flagged inactive
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select is(
  (select active from public.users
   where id = '00000001-0000-0000-0000-000000001004'::uuid),
  false,
  'alpha deactivated user has active = false'
);

-- active users still true
select is(
  (select count(*)::int from public.users
   where active = true and facility_id = '00000001-0000-0000-0000-000000000001'::uuid),
  3,
  'alpha facility has 3 active users (admin, manager, staff)'
);

-- Alpha admin can flip a user's active flag (valid RLS path)
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select lives_ok(
  $$update public.users set active = false
    where id = '00000001-0000-0000-0000-000000001003'::uuid$$,
  'alpha admin can deactivate alpha staff'
);

-- Confirm effect
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select is(
  (select active from public.users
   where id = '00000001-0000-0000-0000-000000001003'::uuid),
  false,
  'alpha staff is now deactivated'
);

-- Alpha admin cannot flip a beta user's active flag (cross-facility)
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
with upd as (
  update public.users set active = false
  where id = '00000002-0000-0000-0000-000000002003'::uuid
  returning id
)
select is((select count(*)::int from upd), 0, 'alpha admin cannot deactivate beta staff (RLS)');

select * from finish();
rollback;
