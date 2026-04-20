-- supabase/tests/22_agent_3_per_op_attacks.test.sql
--
-- Agent 3 module hardening — cross-facility per-operation attacks for the
-- 4 standalone submission tables (accident, incident, refrigeration,
-- air_quality). Complements 14_module_sanity.test.sql which already covers
-- positive-insert + SELECT isolation for each.
--
-- Pattern mirrors 21_form_engine_per_op_attacks.test.sql:
--   1. Seed one alpha-owned row per table under service role (setup).
--   2. Impersonate beta admin.
--   3. Per table: INSERT with forged facility_id → throws (WITH CHECK fires).
--   4. Per table: cross-facility UPDATE → no throw (RLS silent-filter) +
--      post-hoc assertion that the alpha row is unchanged.
--   5. Per table: cross-facility DELETE → no throw + post-hoc exists.
--
-- Highest data-sensitivity in the product: accident + incident carry injury
-- records. A silent cross-facility leak here is lawsuit material. This is
-- the gap my own Agent 2 engine-hardening PR flagged as the "next
-- engine-hardening-style pass."

begin;
select plan(20);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- ============================================================================
-- Seed one alpha-owned row per table (service role — setup bypass of RLS)
-- ============================================================================
reset role;

-- accident_submissions
insert into public.accident_submissions
  (facility_id, submitted_by, form_schema_version,
   date_of_accident, time_of_accident, location_in_facility, custom_fields)
values (
  '00000001-0000-0000-0000-000000000001'::uuid,
  '00000001-0000-0000-0000-000000001002'::uuid,
  1,
  current_date,
  '10:00',
  '22-test-accident-location',
  '{"marker":"pristine"}'::jsonb
);

-- incident_submissions
insert into public.incident_submissions
  (facility_id, submitted_by, form_schema_version,
   date_of_incident, time_of_incident, location_in_facility, custom_fields)
values (
  '00000001-0000-0000-0000-000000000001'::uuid,
  '00000001-0000-0000-0000-000000001002'::uuid,
  1,
  current_date,
  '11:00',
  '22-test-incident-location',
  '{"marker":"pristine"}'::jsonb
);

-- refrigeration_submissions
insert into public.refrigeration_submissions
  (facility_id, submitted_by, form_schema_version,
   reading_taken_at, compressor_resource_id, custom_fields, idempotency_key)
select
  '00000001-0000-0000-0000-000000000001'::uuid,
  '00000001-0000-0000-0000-000000001002'::uuid,
  1,
  now(),
  fr.id,
  '{"marker":"pristine"}'::jsonb,
  '22-test-refrig-seed'
from public.facility_resources fr
where fr.facility_id = '00000001-0000-0000-0000-000000000001'::uuid
  and fr.resource_type = 'compressor'
limit 1;

-- air_quality_submissions
insert into public.air_quality_submissions
  (facility_id, submitted_by, form_schema_version,
   reading_taken_at, device_resource_id, location_of_reading, custom_fields)
select
  '00000001-0000-0000-0000-000000000001'::uuid,
  '00000001-0000-0000-0000-000000001002'::uuid,
  1,
  now(),
  fr.id,
  'center ice — 22-test-seed',
  '{"marker":"pristine"}'::jsonb
from public.facility_resources fr
where fr.facility_id = '00000001-0000-0000-0000-000000000001'::uuid
  and fr.resource_type = 'air_quality_device'
limit 1;

-- ============================================================================
-- accident_submissions
-- ============================================================================
select _test_as('00000002-0000-0000-0000-000000002001'::uuid);  -- beta admin

-- Attack 1: INSERT with forged alpha facility_id
select throws_ok(
  $$insert into public.accident_submissions
      (facility_id, submitted_by, form_schema_version,
       date_of_accident, time_of_accident, location_in_facility, custom_fields)
    values (
      '00000001-0000-0000-0000-000000000001',
      '00000002-0000-0000-0000-000000002001',
      1, current_date, '10:00', 'hostile', '{}'::jsonb)$$,
  null,
  'accident_submissions: beta cannot forge alpha facility_id'
);

-- Attack 2: UPDATE alpha's accident row (RLS silent-filter)
select lives_ok(
  $$update public.accident_submissions
    set custom_fields = '{"marker":"hostile"}'::jsonb
    where location_in_facility = '22-test-accident-location'$$,
  'accident_submissions: cross-facility UPDATE does not throw (RLS silent-filter)'
);

reset role;
select is(
  (select custom_fields->>'marker' from public.accident_submissions
   where location_in_facility = '22-test-accident-location'),
  'pristine',
  'accident_submissions: alpha row marker still "pristine" after beta UPDATE'
);

-- Attack 3: DELETE alpha's accident row
select _test_as('00000002-0000-0000-0000-000000002001'::uuid);
select lives_ok(
  $$delete from public.accident_submissions
    where location_in_facility = '22-test-accident-location'$$,
  'accident_submissions: cross-facility DELETE does not throw'
);

reset role;
select cmp_ok(
  (select count(*)::int from public.accident_submissions
   where location_in_facility = '22-test-accident-location'),
  '=', 1,
  'accident_submissions: alpha row still exists after beta DELETE'
);

-- ============================================================================
-- incident_submissions
-- ============================================================================
select _test_as('00000002-0000-0000-0000-000000002001'::uuid);

select throws_ok(
  $$insert into public.incident_submissions
      (facility_id, submitted_by, form_schema_version,
       date_of_incident, time_of_incident, location_in_facility, custom_fields)
    values (
      '00000001-0000-0000-0000-000000000001',
      '00000002-0000-0000-0000-000000002001',
      1, current_date, '11:00', 'hostile', '{}'::jsonb)$$,
  null,
  'incident_submissions: beta cannot forge alpha facility_id'
);

select lives_ok(
  $$update public.incident_submissions
    set custom_fields = '{"marker":"hostile"}'::jsonb
    where location_in_facility = '22-test-incident-location'$$,
  'incident_submissions: cross-facility UPDATE does not throw'
);

reset role;
select is(
  (select custom_fields->>'marker' from public.incident_submissions
   where location_in_facility = '22-test-incident-location'),
  'pristine',
  'incident_submissions: alpha row marker still "pristine" after beta UPDATE'
);

select _test_as('00000002-0000-0000-0000-000000002001'::uuid);
select lives_ok(
  $$delete from public.incident_submissions
    where location_in_facility = '22-test-incident-location'$$,
  'incident_submissions: cross-facility DELETE does not throw'
);

reset role;
select cmp_ok(
  (select count(*)::int from public.incident_submissions
   where location_in_facility = '22-test-incident-location'),
  '=', 1,
  'incident_submissions: alpha row still exists after beta DELETE'
);

-- ============================================================================
-- refrigeration_submissions
-- ============================================================================
select _test_as('00000002-0000-0000-0000-000000002001'::uuid);

select throws_ok(
  $$insert into public.refrigeration_submissions
      (facility_id, submitted_by, form_schema_version,
       reading_taken_at, compressor_resource_id, custom_fields)
    select
      '00000001-0000-0000-0000-000000000001',
      '00000002-0000-0000-0000-000000002001',
      1, now(), fr.id, '{}'::jsonb
    from public.facility_resources fr
    where fr.facility_id = '00000001-0000-0000-0000-000000000001'::uuid
      and fr.resource_type = 'compressor' limit 1$$,
  null,
  'refrigeration_submissions: beta cannot forge alpha facility_id'
);

select lives_ok(
  $$update public.refrigeration_submissions
    set custom_fields = '{"marker":"hostile"}'::jsonb
    where idempotency_key = '22-test-refrig-seed'$$,
  'refrigeration_submissions: cross-facility UPDATE does not throw'
);

reset role;
select is(
  (select custom_fields->>'marker' from public.refrigeration_submissions
   where idempotency_key = '22-test-refrig-seed'),
  'pristine',
  'refrigeration_submissions: alpha row marker still "pristine" after beta UPDATE'
);

select _test_as('00000002-0000-0000-0000-000000002001'::uuid);
select lives_ok(
  $$delete from public.refrigeration_submissions
    where idempotency_key = '22-test-refrig-seed'$$,
  'refrigeration_submissions: cross-facility DELETE does not throw'
);

reset role;
select cmp_ok(
  (select count(*)::int from public.refrigeration_submissions
   where idempotency_key = '22-test-refrig-seed'),
  '=', 1,
  'refrigeration_submissions: alpha row still exists after beta DELETE'
);

-- ============================================================================
-- air_quality_submissions
-- ============================================================================
select _test_as('00000002-0000-0000-0000-000000002001'::uuid);

select throws_ok(
  $$insert into public.air_quality_submissions
      (facility_id, submitted_by, form_schema_version,
       reading_taken_at, device_resource_id, location_of_reading, custom_fields)
    select
      '00000001-0000-0000-0000-000000000001',
      '00000002-0000-0000-0000-000000002001',
      1, now(), fr.id, 'hostile', '{}'::jsonb
    from public.facility_resources fr
    where fr.facility_id = '00000001-0000-0000-0000-000000000001'::uuid
      and fr.resource_type = 'air_quality_device' limit 1$$,
  null,
  'air_quality_submissions: beta cannot forge alpha facility_id'
);

select lives_ok(
  $$update public.air_quality_submissions
    set custom_fields = '{"marker":"hostile"}'::jsonb
    where location_of_reading = 'center ice — 22-test-seed'$$,
  'air_quality_submissions: cross-facility UPDATE does not throw'
);

reset role;
select is(
  (select custom_fields->>'marker' from public.air_quality_submissions
   where location_of_reading = 'center ice — 22-test-seed'),
  'pristine',
  'air_quality_submissions: alpha row marker still "pristine" after beta UPDATE'
);

select _test_as('00000002-0000-0000-0000-000000002001'::uuid);
select lives_ok(
  $$delete from public.air_quality_submissions
    where location_of_reading = 'center ice — 22-test-seed'$$,
  'air_quality_submissions: cross-facility DELETE does not throw'
);

reset role;
select cmp_ok(
  (select count(*)::int from public.air_quality_submissions
   where location_of_reading = 'center ice — 22-test-seed'),
  '=', 1,
  'air_quality_submissions: alpha row still exists after beta DELETE'
);

select * from finish();
rollback;
