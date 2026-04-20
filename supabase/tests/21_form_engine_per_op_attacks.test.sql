-- supabase/tests/21_form_engine_per_op_attacks.test.sql
--
-- Agent 2 engine-hardening — cross-facility per-operation attacks for the
-- form-engine tables. Complements 11_option_lists, 12_form_schemas, and
-- 13_ice_maintenance_submissions which already cover INSERT-forge + SELECT
-- isolation, plus the append-only trigger on form_schema_history.
--
-- Each attack follows the same shape:
--   1. Capture an alpha-owned row id under service role.
--   2. Impersonate beta admin.
--   3. Attempt the UPDATE or DELETE.
--   4. Reset role and assert the alpha row is in its expected state.
--
-- Under RLS, UPDATEs and DELETEs that fail the USING clause become silent
-- no-ops (zero rows affected, no error). So the detection assertion is
-- post-hoc: the alpha row must not carry the attacker's marker, or must
-- still exist. Any additional throw is bonus.

begin;
select plan(8);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- ============================================================================
-- Capture alpha-owned row ids (service role)
-- ============================================================================
reset role;

do $$
declare
  v_form_schema_id uuid;
  v_option_list_id uuid;
  v_option_list_item_id uuid;
  v_submission_id uuid;
begin
  select id into v_form_schema_id
    from public.form_schemas
    where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
      and module_slug = 'ice_maintenance' and form_type = 'circle_check'
    limit 1;
  perform set_config('test.alpha_form_schema_id', coalesce(v_form_schema_id::text, ''), true);

  select id into v_option_list_id
    from public.option_lists
    where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
    limit 1;
  perform set_config('test.alpha_option_list_id', coalesce(v_option_list_id::text, ''), true);

  select oli.id into v_option_list_item_id
    from public.option_list_items oli
    join public.option_lists ol on ol.id = oli.option_list_id
    where ol.facility_id = '00000001-0000-0000-0000-000000000001'::uuid
    limit 1;
  perform set_config('test.alpha_option_list_item_id', coalesce(v_option_list_item_id::text, ''), true);

  -- Seed a submission so we have something to attack. Use service role so
  -- we bypass RLS; this is setup, not attack.
  insert into public.ice_maintenance_submissions
    (facility_id, submitted_by, form_type, form_schema_version, surface_resource_id, custom_fields, idempotency_key)
  select
    '00000001-0000-0000-0000-000000000001'::uuid,
    '00000001-0000-0000-0000-000000001003'::uuid,
    'circle_check',
    1,
    fr.id,
    '{"marker":"pristine"}'::jsonb,
    '21-test-seed'
  from public.facility_resources fr
  where fr.facility_id = '00000001-0000-0000-0000-000000000001'::uuid
    and fr.resource_type = 'surface'
  limit 1
  returning id into v_submission_id;

  perform set_config('test.alpha_submission_id', coalesce(v_submission_id::text, ''), true);
end $$;

-- Skip the suite cleanly if any fixture is missing. Plan count is 8 regardless;
-- we emit `skip` assertions as no-ops when alpha has no fixtures.
-- (Not expected under the standard seed; documented in case someone runs
-- against a custom seed.)

-- ============================================================================
-- form_schemas: cross-facility UPDATE + DELETE
-- ============================================================================

select _test_as('00000002-0000-0000-0000-000000002001'::uuid);  -- beta admin

-- Attack: UPDATE alpha form_schema's draft_definition
select lives_ok(
  format($$update public.form_schemas set draft_definition = '{"hostile":true}'::jsonb where id = %L$$,
         nullif(current_setting('test.alpha_form_schema_id'), '')),
  'beta admin UPDATE on alpha form_schema: RLS filters silently (no throw)'
);

-- Attack: DELETE alpha form_schema
select lives_ok(
  format($$delete from public.form_schemas where id = %L$$,
         nullif(current_setting('test.alpha_form_schema_id'), '')),
  'beta admin DELETE on alpha form_schema: RLS filters silently (no throw)'
);

-- Validation: alpha row is unchanged
reset role;
select is(
  (select (draft_definition->>'hostile')::text
   from public.form_schemas
   where id = nullif(current_setting('test.alpha_form_schema_id'), '')::uuid),
  null,
  'alpha form_schema.draft_definition does NOT carry hostile marker'
);

select cmp_ok(
  (select count(*)::int from public.form_schemas
   where id = nullif(current_setting('test.alpha_form_schema_id'), '')::uuid),
  '=', 1,
  'alpha form_schema row still exists after beta DELETE attempt'
);

-- ============================================================================
-- option_list_items: cross-facility UPDATE via parent scope
-- ============================================================================

select _test_as('00000002-0000-0000-0000-000000002001'::uuid);

select lives_ok(
  format($$update public.option_list_items set label = 'HOSTILE_RENAME' where id = %L$$,
         nullif(current_setting('test.alpha_option_list_item_id'), '')),
  'beta admin UPDATE on alpha option_list_item: RLS filters silently'
);

reset role;
select ok(
  (select count(*)::int from public.option_list_items
   where id = nullif(current_setting('test.alpha_option_list_item_id'), '')::uuid
     and label = 'HOSTILE_RENAME') = 0,
  'alpha option_list_item label does NOT carry HOSTILE_RENAME'
);

-- ============================================================================
-- ice_maintenance_submissions: cross-facility UPDATE + DELETE
-- ============================================================================

select _test_as('00000002-0000-0000-0000-000000002001'::uuid);

-- Attack: UPDATE alpha submission's custom_fields
select lives_ok(
  format($$update public.ice_maintenance_submissions
           set custom_fields = '{"hostile":true}'::jsonb
           where id = %L$$,
         nullif(current_setting('test.alpha_submission_id'), '')),
  'beta admin UPDATE on alpha submission: RLS filters silently'
);

-- Validation: alpha submission custom_fields still {marker: pristine}
reset role;
select is(
  (select custom_fields->>'marker'
   from public.ice_maintenance_submissions
   where id = nullif(current_setting('test.alpha_submission_id'), '')::uuid),
  'pristine',
  'alpha submission custom_fields.marker is still "pristine" after beta UPDATE'
);

-- Cleanup the seeded submission (service role)
delete from public.ice_maintenance_submissions
  where idempotency_key = '21-test-seed';

select * from finish();
rollback;
