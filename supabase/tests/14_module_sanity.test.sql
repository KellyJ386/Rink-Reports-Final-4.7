-- supabase/tests/14_module_sanity.test.sql
-- Agent 3 sanity tests: one positive insert + one negative cross-facility read per module,
-- plus shared-table discrimination + idempotency for the new standalone tables.
--
-- Module-disablement → 404 behavior is a route-level (Playwright) test, not a pgTAP one —
-- the DB layer does not enforce facility_modules.is_enabled; the requireModuleEnabled()
-- helper in lib/modules/require-enabled.ts does. We verify here only that the flag flip
-- persists and is readable.

begin;
select plan(18);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- ----------------------------------------------------------------
-- Ice Maintenance: three new form types on the shared table
-- ----------------------------------------------------------------

-- Alpha manager files an Ice Make
select _test_as('00000001-0000-0000-0000-000000001002'::uuid);
select lives_ok(
  $$insert into public.ice_maintenance_submissions
      (submitted_by, form_type, form_schema_version, surface_resource_id,
       water_temp_f, resurface_start_at, resurface_end_at, custom_fields)
    select
      '00000001-0000-0000-0000-000000001002',
      'ice_make',
      1,
      (select id from public.facility_resources
         where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
           and resource_type = 'surface' and name = 'Main Rink' limit 1),
      165, now() - interval '10 min', now(),
      '{"observed_condition":"good","lap_count":6,"cut_depth_pass":"full_flood"}'::jsonb$$,
  'alpha manager files an Ice Make'
);

-- Alpha manager files an Edging (same table, different form_type)
select lives_ok(
  $$insert into public.ice_maintenance_submissions
      (submitted_by, form_type, form_schema_version, surface_resource_id, custom_fields)
    select
      '00000001-0000-0000-0000-000000001002',
      'edging',
      1,
      (select id from public.facility_resources
         where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
           and resource_type = 'surface' limit 1),
      '{"perimeter_complete":true}'::jsonb$$,
  'alpha manager files an Edging'
);

-- Alpha manager files a Blade Change
select lives_ok(
  $$insert into public.ice_maintenance_submissions
      (submitted_by, form_type, form_schema_version, surface_resource_id,
       zamboni_resource_id, blade_serial, custom_fields)
    select
      '00000001-0000-0000-0000-000000001002',
      'blade_change',
      1,
      (select id from public.facility_resources
         where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
           and resource_type = 'surface' limit 1),
      (select id from public.facility_resources
         where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
           and resource_type = 'zamboni' limit 1),
      'BL-2026-00042',
      '{"old_blade_condition":"dull","new_blade_source":"factory_new"}'::jsonb$$,
  'alpha manager files a Blade Change'
);

-- Shared-table discrimination: the three inserts above show up filtered by form_type
select cmp_ok(
  (select count(*)::int from public.ice_maintenance_submissions
   where form_type = 'ice_make'),
  '>=',
  1,
  'form_type=ice_make filter returns at least the seed row'
);

select cmp_ok(
  (select count(*)::int from public.ice_maintenance_submissions
   where form_type = 'blade_change'),
  '>=',
  1,
  'form_type=blade_change filter returns at least the seed row'
);

-- Beta user cannot see alpha's Ice Make/Edging/Blade Change rows
select _test_as('00000002-0000-0000-0000-000000002003'::uuid);
select is(
  (select count(*)::int from public.ice_maintenance_submissions
   where form_type in ('ice_make','edging','blade_change')
     and facility_id = '00000001-0000-0000-0000-000000000001'::uuid),
  0,
  'beta staff does not see alpha ice maintenance (all new form types)'
);

-- ----------------------------------------------------------------
-- Refrigeration
-- ----------------------------------------------------------------
select _test_as('00000001-0000-0000-0000-000000001002'::uuid);
select lives_ok(
  $$insert into public.refrigeration_submissions
      (submitted_by, form_schema_version, reading_taken_at, compressor_resource_id, custom_fields)
    select
      '00000001-0000-0000-0000-000000001002',
      1,
      now(),
      (select id from public.facility_resources
         where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
           and resource_type = 'compressor' limit 1),
      '{"suction_pressure_psi":42,"condenser_fan_running":true}'::jsonb$$,
  'alpha manager files a refrigeration reading'
);

select _test_as('00000002-0000-0000-0000-000000002003'::uuid);
select is(
  (select count(*)::int from public.refrigeration_submissions
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid),
  0,
  'beta staff does not see alpha refrigeration submissions'
);

-- Refrigeration idempotency: duplicate key rejected
select _test_as('00000001-0000-0000-0000-000000001002'::uuid);
select lives_ok(
  $$insert into public.refrigeration_submissions
      (submitted_by, form_schema_version, reading_taken_at, compressor_resource_id,
       custom_fields, idempotency_key)
    select
      '00000001-0000-0000-0000-000000001002',
      1,
      now(),
      (select id from public.facility_resources
         where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
           and resource_type = 'compressor' limit 1),
      '{}'::jsonb,
      'idem-refrig-0001'$$,
  'refrigeration insert with new idempotency_key'
);

select throws_ok(
  $$insert into public.refrigeration_submissions
      (submitted_by, form_schema_version, reading_taken_at, compressor_resource_id,
       custom_fields, idempotency_key)
    select
      '00000001-0000-0000-0000-000000001002',
      1,
      now(),
      (select id from public.facility_resources
         where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
           and resource_type = 'compressor' limit 1),
      '{}'::jsonb,
      'idem-refrig-0001'$$,
  '23505',
  'refrigeration duplicate idempotency_key rejected'
);

-- ----------------------------------------------------------------
-- Air Quality
-- ----------------------------------------------------------------
select lives_ok(
  $$insert into public.air_quality_submissions
      (submitted_by, form_schema_version, reading_taken_at, device_resource_id,
       location_of_reading, custom_fields)
    select
      '00000001-0000-0000-0000-000000001002',
      1,
      now(),
      (select id from public.facility_resources
         where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
           and resource_type = 'air_quality_device' limit 1),
      'center ice',
      '{"co_ppm":2.3,"no2_ppm":0.15}'::jsonb$$,
  'alpha manager files an air quality reading'
);

select _test_as('00000002-0000-0000-0000-000000002003'::uuid);
select is(
  (select count(*)::int from public.air_quality_submissions
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid),
  0,
  'beta staff does not see alpha air quality submissions'
);

-- ----------------------------------------------------------------
-- Accident
-- ----------------------------------------------------------------
select _test_as('00000001-0000-0000-0000-000000001002'::uuid);
select lives_ok(
  $$insert into public.accident_submissions
      (submitted_by, form_schema_version, date_of_accident, time_of_accident,
       location_in_facility, custom_fields)
    values (
      '00000001-0000-0000-0000-000000001002',
      1,
      current_date,
      '14:35',
      'Main Rink — near penalty box',
      '{"person_name":"Test Person","description":"slip on ice","emergency_services_called":false,"first_aid_administered":true,"followup_required":false}'::jsonb
    )$$,
  'alpha manager files an accident report'
);

select _test_as('00000002-0000-0000-0000-000000002003'::uuid);
select is(
  (select count(*)::int from public.accident_submissions
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid),
  0,
  'beta staff does not see alpha accident submissions'
);

-- ----------------------------------------------------------------
-- Incident
-- ----------------------------------------------------------------
select _test_as('00000001-0000-0000-0000-000000001002'::uuid);
select lives_ok(
  $$insert into public.incident_submissions
      (submitted_by, form_schema_version, date_of_incident, time_of_incident,
       location_in_facility, custom_fields)
    values (
      '00000001-0000-0000-0000-000000001002',
      1,
      current_date,
      '09:00',
      'Zamboni room',
      '{"incident_type":"property_damage","description":"door hinge damaged","estimated_cost_usd":240,"followup_required":false}'::jsonb
    )$$,
  'alpha manager files an incident report'
);

select _test_as('00000002-0000-0000-0000-000000002003'::uuid);
select is(
  (select count(*)::int from public.incident_submissions
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid),
  0,
  'beta staff does not see alpha incident submissions'
);

-- ----------------------------------------------------------------
-- facility_modules.is_enabled flip persists
-- (Route-level 404 enforcement is a Playwright test; here we verify the flag works.)
-- ----------------------------------------------------------------
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select lives_ok(
  $$update public.facility_modules
    set is_enabled = false
    where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
      and module_id = (select id from public.modules where slug = 'incident')$$,
  'platform admin disables incident module for alpha'
);

select is(
  (select is_enabled from public.facility_modules
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
     and module_id = (select id from public.modules where slug = 'incident')),
  false,
  'incident module now disabled for alpha (route helper will 404)'
);

-- Re-enable so other tests aren't affected if run in sequence
select lives_ok(
  $$update public.facility_modules
    set is_enabled = true
    where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
      and module_id = (select id from public.modules where slug = 'incident')$$,
  'platform admin re-enables incident module for alpha'
);

select * from finish();
rollback;
