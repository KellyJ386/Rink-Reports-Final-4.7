-- supabase/tests/11_option_lists.test.sql
-- option_lists + option_list_items: RLS, key immutability trigger, facility isolation.

begin;
select plan(11);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- Alpha admin creates an option list + items
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select lives_ok(
  $$insert into public.option_lists (slug, name, description)
    values ('hazards', 'Circle Check Hazards', 'Common hazards noted during circle checks')$$,
  'alpha admin creates an option list'
);

select lives_ok(
  $$insert into public.option_list_items (option_list_id, key, label, sort_order)
    select id, 'wet_floor', 'Wet floor', 1 from public.option_lists where slug = 'hazards'$$,
  'alpha admin adds first option item'
);

-- Alpha staff can SELECT option lists + items (forms need to resolve these)
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);
select cmp_ok(
  (select count(*)::int from public.option_list_items
   where key = 'wet_floor'),
  '>=',
  1,
  'alpha staff can SELECT option_list_items'
);

-- Alpha staff CANNOT INSERT options (requires admin)
select throws_ok(
  $$insert into public.option_list_items (option_list_id, key, label)
    select id, 'unauthorized', 'Unauthorized'
    from public.option_lists where slug = 'hazards'$$,
  null,
  'alpha staff cannot insert option items'
);

-- Key immutability: alpha admin tries to rename key
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select throws_ok(
  $$update public.option_list_items set key = 'damp_floor' where key = 'wet_floor'$$,
  null,
  'option_list_items.key is immutable (trigger blocks)'
);

-- Label rename is allowed
select lives_ok(
  $$update public.option_list_items set label = 'Wet floor (slip risk)' where key = 'wet_floor'$$,
  'option_list_items.label is editable'
);

-- Deactivation is allowed
select lives_ok(
  $$update public.option_list_items set is_active = false where key = 'wet_floor'$$,
  'option_list_items.is_active flag can be toggled'
);

-- Beta admin cannot see alpha option lists
select _test_as('00000002-0000-0000-0000-000000002001'::uuid);
select is(
  (select count(*)::int from public.option_lists where slug = 'hazards'),
  0,
  'beta admin cannot see alpha option lists'
);

-- Beta admin cannot insert item into alpha's list (cross-facility via join)
select _test_as('00000002-0000-0000-0000-000000002001'::uuid);
select throws_ok(
  $$insert into public.option_list_items (option_list_id, key, label)
    values (
      (select id from public.option_lists where slug = 'hazards'),
      'forged', 'Forged'
    )$$,
  null,
  'beta admin cannot insert item into alpha option list'
);
-- ^ Note: the subselect returns null under beta RLS, so the insert fails on FK/not-null.

-- Slug uniqueness per-facility allowed but not cross-facility (same slug ok across facilities)
select lives_ok(
  $$insert into public.option_lists (slug, name, description)
    values ('hazards', 'Beta Hazards', 'Beta''s own hazard list')$$,
  'beta admin can create option_list with same slug (separate facility)'
);

-- Platform admin sees both facilities' lists
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select is(
  (select count(*)::int from public.option_lists where slug = 'hazards'),
  2,
  'platform admin sees both facilities'' hazards lists'
);

select * from finish();
rollback;
