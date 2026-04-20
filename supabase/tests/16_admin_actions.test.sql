-- supabase/tests/16_admin_actions.test.sql
-- Admin Control Center server-action backing tables: role creation, access-matrix
-- writes, option_list CRUD, facility_modules toggle, facility.settings jsonb writes.
-- Tests the DB-side invariants; route-level access gating is a Playwright concern.

begin;
select plan(14);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- ----------------------------------------------------------------
-- Alpha admin actions land in own facility
-- ----------------------------------------------------------------

-- Create a new facility-level role
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select lives_ok(
  $$insert into public.roles (name, description, is_system)
    values ('Weekend Manager', 'Covers weekends', false)$$,
  'alpha admin creates a facility role'
);

-- Grant module access to the new role
select lives_ok(
  $$insert into public.role_module_access (role_id, module_id, access_level)
    select r.id, m.id, 'write'
    from public.roles r, public.modules m
    where r.facility_id = '00000001-0000-0000-0000-000000000001'::uuid
      and r.name = 'Weekend Manager'
      and m.slug = 'refrigeration'
    on conflict (role_id, module_id) do update set access_level = excluded.access_level$$,
  'alpha admin grants write on refrigeration'
);

-- ----------------------------------------------------------------
-- Facility_id forgery attempts — all blocked
-- ----------------------------------------------------------------

-- Cannot create a role in beta
select throws_ok(
  $$insert into public.roles (facility_id, name, description, is_system)
    values ('00000002-0000-0000-0000-000000000002', 'forged', 'should fail', false)$$,
  null,
  'alpha admin cannot forge beta facility_id in roles insert'
);

-- Cannot grant access to a beta role (facility mismatch check via join RLS)
select throws_ok(
  $$insert into public.role_module_access (role_id, module_id, access_level)
    select '00000002-2000-0000-0000-000000000001'::uuid, m.id, 'admin'
    from public.modules m where m.slug = 'refrigeration' limit 1$$,
  null,
  'alpha admin cannot set access on a beta role'
);

-- Cannot insert option_list with forged facility_id
select throws_ok(
  $$insert into public.option_lists (facility_id, slug, name)
    values ('00000002-0000-0000-0000-000000000002', 'forged_list', 'Forged')$$,
  null,
  'alpha admin cannot forge beta facility_id on option_lists insert'
);

-- ----------------------------------------------------------------
-- Option list + items create + key immutability
-- ----------------------------------------------------------------

select lives_ok(
  $$insert into public.option_lists (slug, name, description)
    values ('injury_types', 'Injury Types', 'Common injury categories')$$,
  'alpha admin creates option list'
);

select lives_ok(
  $$insert into public.option_list_items (option_list_id, key, label, sort_order)
    select id, 'sprain', 'Sprain', 1 from public.option_lists where slug = 'injury_types'$$,
  'alpha admin adds item to list'
);

-- Item key is immutable (trigger)
select throws_ok(
  $$update public.option_list_items set key = 'twist' where key = 'sprain'$$,
  null,
  'option_list_items.key is immutable'
);

-- Label is editable
select lives_ok(
  $$update public.option_list_items set label = 'Sprain / strain' where key = 'sprain'$$,
  'option_list_items.label is editable'
);

-- ----------------------------------------------------------------
-- facility_modules toggle
-- ----------------------------------------------------------------

select lives_ok(
  $$update public.facility_modules
    set is_enabled = false
    where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
      and module_id = (select id from public.modules where slug = 'air_quality')$$,
  'alpha admin disables a module'
);

select is(
  (select is_enabled from public.facility_modules
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
     and module_id = (select id from public.modules where slug = 'air_quality')),
  false,
  'module disablement persists'
);

-- Re-enable for downstream tests
select lives_ok(
  $$update public.facility_modules
    set is_enabled = true
    where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
      and module_id = (select id from public.modules where slug = 'air_quality')$$,
  're-enable for test isolation'
);

-- ----------------------------------------------------------------
-- facilities.settings jsonb write + read-back
-- ----------------------------------------------------------------

select lives_ok(
  $$update public.facilities
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb),
                             '{scheduling,swap_approval_mode}', '"free"')
    where id = '00000001-0000-0000-0000-000000000001'::uuid$$,
  'alpha admin writes facility setting via admin path'
);

select is(
  (select settings->'scheduling'->>'swap_approval_mode' from public.facilities
   where id = '00000001-0000-0000-0000-000000000001'::uuid),
  'free',
  'setting reads back with the new value'
);

select * from finish();
rollback;
