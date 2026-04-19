-- supabase/tests/12_form_schemas.test.sql
-- form_schemas + form_schema_history: state machine, partial uniques (nullable form_type),
-- publish/discard/save RPCs, history append-only, RLS.

begin;
select plan(14);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- Circle Check schema was backfilled for alpha by migration
-- 20260421000005_seed_circle_check.sql. Verify.
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select is(
  (select version from public.form_schemas
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
     and module_slug = 'ice_maintenance' and form_type = 'circle_check'),
  1,
  'alpha has Circle Check v1 after seed'
);

-- Save draft
select lives_ok(
  $$select public.rpc_save_form_schema_draft(
      (select id from public.form_schemas
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and module_slug = 'ice_maintenance' and form_type = 'circle_check'),
      '{"$schema":"rink-form-schema/v1","sections":[{"key":"x","label":"X","fields":[{"key":"y","type":"text","label":"Y","required":false}]}]}'::jsonb
    )$$,
  'alpha admin can save a draft'
);

-- Draft is saved but version unchanged
select is(
  (select version from public.form_schemas
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
     and module_slug = 'ice_maintenance' and form_type = 'circle_check'),
  1,
  'saving a draft does NOT bump version'
);

select isnt(
  (select draft_definition from public.form_schemas
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
     and module_slug = 'ice_maintenance' and form_type = 'circle_check'),
  null,
  'draft_definition is populated'
);

-- Publish
select lives_ok(
  $$select * from public.rpc_publish_form_schema(
      (select id from public.form_schemas
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and module_slug = 'ice_maintenance' and form_type = 'circle_check')
    )$$,
  'alpha admin can publish draft'
);

-- Version bumped to 2
select is(
  (select version from public.form_schemas
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
     and module_slug = 'ice_maintenance' and form_type = 'circle_check'),
  2,
  'publish bumped version to 2'
);

-- Draft cleared
select is(
  (select draft_definition from public.form_schemas
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
     and module_slug = 'ice_maintenance' and form_type = 'circle_check'),
  null,
  'publish cleared draft_definition'
);

-- History snapshot exists for v1
select is(
  (select count(*)::int from public.form_schema_history
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
     and module_slug = 'ice_maintenance' and form_type = 'circle_check'
     and version = 1),
  1,
  'v1 snapshot written to form_schema_history on publish'
);

-- History is append-only (trigger)
select throws_ok(
  $$update public.form_schema_history set schema_definition = '{}'::jsonb
    where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
      and module_slug = 'ice_maintenance'$$,
  null,
  'form_schema_history UPDATE blocked by trigger'
);

select throws_ok(
  $$delete from public.form_schema_history
    where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
      and module_slug = 'ice_maintenance'$$,
  null,
  'form_schema_history DELETE blocked by trigger'
);

-- Publish without draft errors
select throws_ok(
  $$select * from public.rpc_publish_form_schema(
      (select id from public.form_schemas
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and module_slug = 'ice_maintenance' and form_type = 'circle_check')
    )$$,
  null,
  'publishing with no draft raises'
);

-- Discard is idempotent (no draft → ok)
select lives_ok(
  $$select public.rpc_discard_form_schema_draft(
      (select id from public.form_schemas
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and module_slug = 'ice_maintenance' and form_type = 'circle_check')
    )$$,
  'discard with no draft is idempotent'
);

-- Alpha staff cannot publish (lacks admin)
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);
select throws_ok(
  $$select * from public.rpc_publish_form_schema(
      (select id from public.form_schemas
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and module_slug = 'ice_maintenance' and form_type = 'circle_check')
    )$$,
  null,
  'alpha staff cannot publish form schemas'
);

-- Cross-facility: alpha admin cannot publish beta's schema
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select throws_ok(
  $$select * from public.rpc_publish_form_schema(
      (select id from public.form_schemas
       where facility_id = '00000002-0000-0000-0000-000000000002'::uuid
         and module_slug = 'ice_maintenance' and form_type = 'circle_check')
    )$$,
  null,
  'alpha admin cannot publish beta''s form schema'
);

select * from finish();
rollback;
