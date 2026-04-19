-- supabase/tests/05_system_role_protection.test.sql
-- Verify is_system roles cannot be renamed or deleted.

begin;
select plan(4);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- Alpha admin tries to rename the system Admin role
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);

select throws_ok(
  $$update public.roles set name = 'Renamed Admin'
    where id = '00000001-1000-0000-0000-000000000001'::uuid$$,
  null,
  'cannot rename a system role'
);

select throws_ok(
  $$delete from public.roles
    where id = '00000001-1000-0000-0000-000000000001'::uuid$$,
  null,
  'cannot delete a system role'
);

-- is_system flag cannot be flipped on an existing row
select throws_ok(
  $$update public.roles set is_system = false
    where id = '00000001-1000-0000-0000-000000000001'::uuid$$,
  null,
  'cannot flip is_system on existing role'
);

-- Can still rename non-system roles
select lives_ok(
  $$update public.roles set name = 'Shift Manager'
    where id = '00000001-1000-0000-0000-000000000002'::uuid$$,
  'non-system role (Manager) can be renamed'
);

select * from finish();
rollback;
