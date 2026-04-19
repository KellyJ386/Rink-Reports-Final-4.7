-- supabase/tests/02_tenant_isolation.test.sql
-- The hard gate: prove Facility A users cannot see, insert, update, or delete
-- Facility B rows in any tenant-scoped table.

begin;
select plan(30);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- Start as Alpha staff for cross-facility read tests
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);

-- ----------------------------------------------------------------
-- SELECT isolation
-- ----------------------------------------------------------------

-- Alpha staff should see Alpha rows
select is(
  (select count(*)::int from public.facilities
   where id = '00000001-0000-0000-0000-000000000001'::uuid),
  1,
  'alpha staff sees alpha facility'
);

-- Alpha staff should NOT see Beta rows
select is(
  (select count(*)::int from public.facilities
   where id = '00000002-0000-0000-0000-000000000002'::uuid),
  0,
  'alpha staff does NOT see beta facility'
);

select is(
  (select count(*)::int from public.users
   where facility_id = '00000002-0000-0000-0000-000000000002'::uuid),
  0,
  'alpha staff does NOT see beta users'
);

select is(
  (select count(*)::int from public.roles
   where facility_id = '00000002-0000-0000-0000-000000000002'::uuid),
  0,
  'alpha staff does NOT see beta roles'
);

select is(
  (select count(*)::int from public.user_roles ur
   join public.users u on u.id = ur.user_id
   where u.facility_id = '00000002-0000-0000-0000-000000000002'::uuid),
  0,
  'alpha staff does NOT see beta user_roles'
);

select is(
  (select count(*)::int from public.facility_modules
   where facility_id = '00000002-0000-0000-0000-000000000002'::uuid),
  0,
  'alpha staff does NOT see beta facility_modules'
);

select is(
  (select count(*)::int from public.role_module_access rma
   join public.roles r on r.id = rma.role_id
   where r.facility_id = '00000002-0000-0000-0000-000000000002'::uuid),
  0,
  'alpha staff does NOT see beta role_module_access'
);

select is(
  (select count(*)::int from public.audit_log
   where facility_id = '00000002-0000-0000-0000-000000000002'::uuid),
  0,
  'alpha staff does NOT see beta audit_log'
);

-- ----------------------------------------------------------------
-- INSERT isolation: forged facility_id rejected
-- ----------------------------------------------------------------
-- Switch to alpha admin (who has INSERT rights for roles/resources)
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);

-- Try to insert a role with beta's facility_id → must be blocked by RLS WITH CHECK
select throws_ok(
  $$insert into public.roles (facility_id, name, description)
    values ('00000002-0000-0000-0000-000000000002', 'Forged Role', 'should fail')$$,
  null,
  'alpha admin cannot insert a role with beta facility_id'
);

-- Try to insert a facility_modules row with forged facility_id
select throws_ok(
  $$insert into public.facility_modules (facility_id, module_id, is_enabled)
    select '00000002-0000-0000-0000-000000000002', id, true
    from public.modules where slug = 'ice_depth' limit 1$$,
  null,
  'alpha admin cannot insert facility_modules with forged facility_id'
);

-- Verify nothing was actually inserted
select is(
  (select count(*)::int from public.roles where name = 'Forged Role'),
  0,
  'no forged role row exists'
);

-- Valid insert in own facility succeeds
select lives_ok(
  $$insert into public.roles (facility_id, name, description)
    values ('00000001-0000-0000-0000-000000000001', 'Alpha Test Role', 'valid')$$,
  'alpha admin can insert role in own facility'
);

-- ----------------------------------------------------------------
-- UPDATE isolation
-- ----------------------------------------------------------------

-- Alpha admin attempts to UPDATE beta's facility — should affect 0 rows (RLS filters out)
with upd as (
  update public.facilities set name = 'Hacked Beta'
  where id = '00000002-0000-0000-0000-000000000002'::uuid
  returning id
)
select is((select count(*)::int from upd), 0, 'alpha admin UPDATE of beta facility affects 0 rows');

-- Confirm beta still has its original name (switch to platform admin to verify)
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select is(
  (select name from public.facilities where id = '00000002-0000-0000-0000-000000000002'::uuid),
  'Rink Beta',
  'beta facility name unchanged after alpha UPDATE attempt'
);

-- Alpha admin attempting to flip a beta user's active flag → 0 rows
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
with upd as (
  update public.users set active = false
  where id = '00000002-0000-0000-0000-000000002003'::uuid
  returning id
)
select is((select count(*)::int from upd), 0, 'alpha admin UPDATE of beta user affects 0 rows');

-- Verify beta staff still active (platform admin view)
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select is(
  (select active from public.users where id = '00000002-0000-0000-0000-000000002003'::uuid),
  true,
  'beta staff remains active after alpha UPDATE attempt'
);

-- ----------------------------------------------------------------
-- User facility_id immutability
-- ----------------------------------------------------------------

-- A user cannot mutate their own facility_id. The RLS policy on UPDATE users is
-- already restrictive (facility admin only), and the trigger is a belt-and-suspenders.
-- Test that even the alpha admin cannot move alpha staff to beta.
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);

select throws_ok(
  $$update public.users set facility_id = '00000002-0000-0000-0000-000000000002'
    where id = '00000001-0000-0000-0000-000000001003'::uuid$$,
  null,
  'facility admin cannot mutate a user facility_id (trigger blocks)'
);

-- Self-mutation also blocked (trigger fires regardless of RLS)
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);  -- alpha staff
select throws_ok(
  $$update public.users set facility_id = '00000002-0000-0000-0000-000000000002'
    where id = '00000001-0000-0000-0000-000000001003'::uuid$$,
  null,
  'user cannot self-mutate facility_id'
);

-- ----------------------------------------------------------------
-- DELETE isolation
-- ----------------------------------------------------------------

select _test_as('00000001-0000-0000-0000-000000001001'::uuid);

-- Alpha admin attempts to DELETE a beta role → 0 rows
with del as (
  delete from public.roles
  where facility_id = '00000002-0000-0000-0000-000000000002'::uuid
  returning id
)
select is((select count(*)::int from del), 0, 'alpha admin DELETE of beta roles affects 0 rows');

-- Confirm beta roles intact
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select is(
  (select count(*)::int from public.roles
   where facility_id = '00000002-0000-0000-0000-000000000002'::uuid),
  3,
  'beta still has 3 roles after alpha DELETE attempt'
);

-- ----------------------------------------------------------------
-- user_roles cross-facility assignment blocked
-- ----------------------------------------------------------------

select _test_as('00000001-0000-0000-0000-000000001001'::uuid);

-- Try to assign alpha staff to a beta role — trigger must block
select throws_ok(
  $$insert into public.user_roles (user_id, role_id)
    values ('00000001-0000-0000-0000-000000001003'::uuid,
            '00000002-2000-0000-0000-000000000001'::uuid)$$,
  null,
  'cannot assign alpha user to beta role (trigger blocks)'
);

-- ----------------------------------------------------------------
-- audit_log append-only
-- ----------------------------------------------------------------

select _test_as('00000001-0000-0000-0000-000000001001'::uuid);

-- Can INSERT audit events for own facility
select lives_ok(
  $$insert into public.audit_log (facility_id, actor_user_id, action, entity_type, metadata)
    values ('00000001-0000-0000-0000-000000000001',
            '00000001-0000-0000-0000-000000001001',
            'test.event', 'test', '{}'::jsonb)$$,
  'alpha admin can insert audit_log for own facility'
);

-- Cannot INSERT audit events forging facility_id
select throws_ok(
  $$insert into public.audit_log (facility_id, actor_user_id, action)
    values ('00000002-0000-0000-0000-000000000002',
            '00000001-0000-0000-0000-000000001001',
            'forged.event')$$,
  null,
  'alpha admin cannot forge facility_id on audit_log insert'
);

-- Cannot INSERT audit with a different actor_user_id
select throws_ok(
  $$insert into public.audit_log (facility_id, actor_user_id, action)
    values ('00000001-0000-0000-0000-000000000001',
            '00000002-0000-0000-0000-000000002001',
            'actor.forge')$$,
  null,
  'alpha admin cannot use another user as actor_user_id'
);

-- UPDATE blocked by trigger
select throws_ok(
  $$update public.audit_log set action = 'tampered' where actor_user_id = auth.uid()$$,
  null,
  'audit_log UPDATE blocked by trigger'
);

-- DELETE blocked by trigger
select throws_ok(
  $$delete from public.audit_log where actor_user_id = auth.uid()$$,
  null,
  'audit_log DELETE blocked by trigger'
);

-- ----------------------------------------------------------------
-- Anonymous (no auth) sees nothing
-- ----------------------------------------------------------------

select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*)::int from public.facilities),
  0,
  'anon cannot SELECT any facility'
);

select is(
  (select count(*)::int from public.users),
  0,
  'anon cannot SELECT any user'
);

select is(
  (select count(*)::int from public.roles),
  0,
  'anon cannot SELECT any role'
);

-- modules is global-read by design (catalog), so anon gets denied by role (not authenticated)
select is(
  (select count(*)::int from public.modules),
  0,
  'anon cannot SELECT modules (authenticated-only)'
);

select * from finish();
rollback;
