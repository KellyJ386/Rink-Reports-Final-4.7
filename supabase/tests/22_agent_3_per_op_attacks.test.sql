-- supabase/tests/22_agent_3_per_op_attacks.test.sql
--
-- Cross-facility per-operation RLS attack coverage for the four standalone
-- submission tables from 20260422000001_standalone_submission_tables.sql:
--   accident_submissions, incident_submissions,
--   refrigeration_submissions, air_quality_submissions.
--
-- Complements 14_module_sanity (positive insert + SELECT isolation).
--
-- Each table gets three attacks:
--   1. Forge INSERT  (explicit alpha facility_id) → throws (WITH CHECK)
--   2. Cross-facility UPDATE attack               → silent no-op (USING) + validation
--   3. Cross-facility DELETE attack               → silent no-op (USING) + validation
--
-- Under RLS, UPDATEs and DELETEs that fail USING are silent no-ops; detection
-- is post-hoc via a validation assertion on the alpha row.
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
-- Note on refrigeration/air_quality forge attacks: the INSERT subquery uses
-- the attacker's OWN resources (visible via their facility's RLS scope) while
-- setting facility_id to the victim facility.  This ensures the INSERT always
-- has a row to attempt, letting the RLS WITH CHECK fire and throw 42501.
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
-- Seed one alpha-owned row per table (service role, bypasses RLS)
-- ============================================================================
reset role;

do $$
declare
  v_compressor  uuid;
  v_aq_device   uuid;
  v_accid_id    uuid;
  v_incid_id    uuid;
  v_refrig_id   uuid;
  v_airq_id     uuid;
begin
  select id into v_compressor
    from public.facility_resources
    where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
      and resource_type = 'compressor'
    limit 1;

  select id into v_aq_device
    from public.facility_resources
    where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
      and resource_type = 'air_quality_device'
    limit 1;

  insert into public.accident_submissions
    (facility_id, submitted_by, form_schema_version, date_of_accident,
     time_of_accident, location_in_facility, custom_fields, idempotency_key)
  values (
    '00000001-0000-0000-0000-000000000001',
    '00000001-0000-0000-0000-000000001002',
    1, current_date, '10:00', 'Main Rink', '{}', '22-accid-seed'
  )
  returning id into v_accid_id;
  perform set_config('test.alpha_accid_id', coalesce(v_accid_id::text, ''), true);

  insert into public.incident_submissions
    (facility_id, submitted_by, form_schema_version, date_of_incident,
     time_of_incident, location_in_facility, custom_fields, idempotency_key)
  values (
    '00000001-0000-0000-0000-000000000001',
    '00000001-0000-0000-0000-000000001002',
    1, current_date, '10:00', 'Zamboni Room', '{}', '22-incid-seed'
  )
  returning id into v_incid_id;
  perform set_config('test.alpha_incid_id', coalesce(v_incid_id::text, ''), true);

  insert into public.refrigeration_submissions
    (facility_id, submitted_by, form_schema_version, reading_taken_at,
     compressor_resource_id, custom_fields, idempotency_key)
  values (
    '00000001-0000-0000-0000-000000000001',
    '00000001-0000-0000-0000-000000001002',
    1, now(), v_compressor, '{"marker":"pristine"}', '22-refrig-seed'
  )
  returning id into v_refrig_id;
  perform set_config('test.alpha_refrig_id', coalesce(v_refrig_id::text, ''), true);

  insert into public.air_quality_submissions
    (facility_id, submitted_by, form_schema_version, reading_taken_at,
     device_resource_id, location_of_reading, custom_fields, idempotency_key)
  values (
    '00000001-0000-0000-0000-000000000001',
    '00000001-0000-0000-0000-000000001002',
    1, now(), v_aq_device, 'center ice', '{"marker":"pristine"}', '22-airq-seed'
  )
  returning id into v_airq_id;
  perform set_config('test.alpha_airq_id', coalesce(v_airq_id::text, ''), true);
end $$;
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

-- refrigeration_submissions (service role sees all facility_resources)
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

-- air_quality_submissions (service role sees all facility_resources)
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

select throws_ok(
  $$insert into public.accident_submissions
      (facility_id, submitted_by, form_schema_version, date_of_accident,
       time_of_accident, location_in_facility)
    values (
      '00000001-0000-0000-0000-000000000001',
      '00000002-0000-0000-0000-000000002001',
      1, current_date, '10:00', 'FORGED'
    )$$,
  null,
  'beta admin cannot forge INSERT into accident_submissions with alpha facility_id'
);

select lives_ok(
  format($$update public.accident_submissions
           set location_in_facility = 'HOSTILE_ATTACK'
           where id = %L$$,
         nullif(current_setting('test.alpha_accid_id'), '')),
  'beta admin UPDATE on alpha accident_submission: RLS filters silently'
select _test_as('00000002-0000-0000-0000-000000002001'::uuid);  -- beta admin

-- Attack 1: INSERT with forged alpha facility_id (VALUES — always has a row)
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
  (select location_in_facility from public.accident_submissions
   where id = nullif(current_setting('test.alpha_accid_id'), '')::uuid),
  'Main Rink',
  'alpha accident_submission.location_in_facility unchanged after beta UPDATE attempt'
);

select _test_as('00000002-0000-0000-0000-000000002001'::uuid);
select lives_ok(
  format($$delete from public.accident_submissions where id = %L$$,
         nullif(current_setting('test.alpha_accid_id'), '')),
  'beta admin DELETE on alpha accident_submission: RLS filters silently'
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
   where id = nullif(current_setting('test.alpha_accid_id'), '')::uuid),
  '=', 1,
  'alpha accident_submission row still exists after beta DELETE attempt'
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
      (facility_id, submitted_by, form_schema_version, date_of_incident,
       time_of_incident, location_in_facility)
    values (
      '00000001-0000-0000-0000-000000000001',
      '00000002-0000-0000-0000-000000002001',
      1, current_date, '10:00', 'FORGED'
    )$$,
  null,
  'beta admin cannot forge INSERT into incident_submissions with alpha facility_id'
);

select lives_ok(
  format($$update public.incident_submissions
           set location_in_facility = 'HOSTILE_ATTACK'
           where id = %L$$,
         nullif(current_setting('test.alpha_incid_id'), '')),
  'beta admin UPDATE on alpha incident_submission: RLS filters silently'
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
  (select location_in_facility from public.incident_submissions
   where id = nullif(current_setting('test.alpha_incid_id'), '')::uuid),
  'Zamboni Room',
  'alpha incident_submission.location_in_facility unchanged after beta UPDATE attempt'
  (select custom_fields->>'marker' from public.incident_submissions
   where location_in_facility = '22-test-incident-location'),
  'pristine',
  'incident_submissions: alpha row marker still "pristine" after beta UPDATE'
);

select _test_as('00000002-0000-0000-0000-000000002001'::uuid);
select lives_ok(
  format($$delete from public.incident_submissions where id = %L$$,
         nullif(current_setting('test.alpha_incid_id'), '')),
  'beta admin DELETE on alpha incident_submission: RLS filters silently'
  $$delete from public.incident_submissions
    where location_in_facility = '22-test-incident-location'$$,
  'incident_submissions: cross-facility DELETE does not throw'
);

reset role;
select cmp_ok(
  (select count(*)::int from public.incident_submissions
   where id = nullif(current_setting('test.alpha_incid_id'), '')::uuid),
  '=', 1,
  'alpha incident_submission row still exists after beta DELETE attempt'
   where location_in_facility = '22-test-incident-location'),
  '=', 1,
  'incident_submissions: alpha row still exists after beta DELETE'
);

-- ============================================================================
-- refrigeration_submissions
-- ============================================================================

select _test_as('00000002-0000-0000-0000-000000002001'::uuid);

-- The subselect for compressor_resource_id returns null under beta RLS
-- (alpha resources not visible), so NOT NULL fires; either way the insert throws.
select throws_ok(
  $$insert into public.refrigeration_submissions
      (facility_id, submitted_by, form_schema_version, reading_taken_at,
       compressor_resource_id)
    select
      '00000001-0000-0000-0000-000000000001',
      '00000002-0000-0000-0000-000000002001',
      1, now(),
      (select id from public.facility_resources
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and resource_type = 'compressor' limit 1)$$,
  null,
  'beta admin cannot forge INSERT into refrigeration_submissions with alpha facility_id'
);

select lives_ok(
  format($$update public.refrigeration_submissions
           set custom_fields = '{"hostile":true}'::jsonb
           where id = %L$$,
         nullif(current_setting('test.alpha_refrig_id'), '')),
  'beta admin UPDATE on alpha refrigeration_submission: RLS filters silently'
-- Forge attack: use beta's OWN compressor (visible via beta's RLS scope) but
-- set facility_id = alpha.  The INSERT always has a row to attempt; RLS WITH
-- CHECK fires because facility_id ≠ current_facility_id() and throws 42501.
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
    where fr.resource_type = 'compressor'
    limit 1$$,
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
  (select custom_fields->>'hostile' from public.refrigeration_submissions
   where id = nullif(current_setting('test.alpha_refrig_id'), '')::uuid),
  null,
  'alpha refrigeration_submission.custom_fields does NOT carry hostile marker after beta UPDATE'
  (select custom_fields->>'marker' from public.refrigeration_submissions
   where idempotency_key = '22-test-refrig-seed'),
  'pristine',
  'refrigeration_submissions: alpha row marker still "pristine" after beta UPDATE'
);

select _test_as('00000002-0000-0000-0000-000000002001'::uuid);
select lives_ok(
  format($$delete from public.refrigeration_submissions where id = %L$$,
         nullif(current_setting('test.alpha_refrig_id'), '')),
  'beta admin DELETE on alpha refrigeration_submission: RLS filters silently'
  $$delete from public.refrigeration_submissions
    where idempotency_key = '22-test-refrig-seed'$$,
  'refrigeration_submissions: cross-facility DELETE does not throw'
);

reset role;
select cmp_ok(
  (select count(*)::int from public.refrigeration_submissions
   where id = nullif(current_setting('test.alpha_refrig_id'), '')::uuid),
  '=', 1,
  'alpha refrigeration_submission row still exists after beta DELETE attempt'
   where idempotency_key = '22-test-refrig-seed'),
  '=', 1,
  'refrigeration_submissions: alpha row still exists after beta DELETE'
);

-- ============================================================================
-- air_quality_submissions
-- ============================================================================

-- Forge attack: use beta's OWN air_quality_device (visible via beta's RLS
-- scope) but set facility_id = alpha.
select _test_as('00000002-0000-0000-0000-000000002001'::uuid);

select throws_ok(
  $$insert into public.air_quality_submissions
      (facility_id, submitted_by, form_schema_version, reading_taken_at,
       device_resource_id, location_of_reading)
    select
      '00000001-0000-0000-0000-000000000001',
      '00000002-0000-0000-0000-000000002001',
      1, now(),
      (select id from public.facility_resources
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and resource_type = 'air_quality_device' limit 1),
      'FORGED'$$,
  null,
  'beta admin cannot forge INSERT into air_quality_submissions with alpha facility_id'
);

select lives_ok(
  format($$update public.air_quality_submissions
           set custom_fields = '{"hostile":true}'::jsonb
           where id = %L$$,
         nullif(current_setting('test.alpha_airq_id'), '')),
  'beta admin UPDATE on alpha air_quality_submission: RLS filters silently'
      (facility_id, submitted_by, form_schema_version,
       reading_taken_at, device_resource_id, location_of_reading, custom_fields)
    select
      '00000001-0000-0000-0000-000000000001',
      '00000002-0000-0000-0000-000000002001',
      1, now(), fr.id, 'hostile', '{}'::jsonb
    from public.facility_resources fr
    where fr.resource_type = 'air_quality_device'
    limit 1$$,
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
  (select custom_fields->>'hostile' from public.air_quality_submissions
   where id = nullif(current_setting('test.alpha_airq_id'), '')::uuid),
  null,
  'alpha air_quality_submission.custom_fields does NOT carry hostile marker after beta UPDATE'
  (select custom_fields->>'marker' from public.air_quality_submissions
   where location_of_reading = 'center ice — 22-test-seed'),
  'pristine',
  'air_quality_submissions: alpha row marker still "pristine" after beta UPDATE'
);

select _test_as('00000002-0000-0000-0000-000000002001'::uuid);
select lives_ok(
  format($$delete from public.air_quality_submissions where id = %L$$,
         nullif(current_setting('test.alpha_airq_id'), '')),
  'beta admin DELETE on alpha air_quality_submission: RLS filters silently'
  $$delete from public.air_quality_submissions
    where location_of_reading = 'center ice — 22-test-seed'$$,
  'air_quality_submissions: cross-facility DELETE does not throw'
);

reset role;
select cmp_ok(
  (select count(*)::int from public.air_quality_submissions
   where id = nullif(current_setting('test.alpha_airq_id'), '')::uuid),
  '=', 1,
  'alpha air_quality_submission row still exists after beta DELETE attempt'
);

-- Cleanup seeded rows (service role)
delete from public.accident_submissions      where idempotency_key = '22-accid-seed';
delete from public.incident_submissions      where idempotency_key = '22-incid-seed';
delete from public.refrigeration_submissions where idempotency_key = '22-refrig-seed';
delete from public.air_quality_submissions   where idempotency_key = '22-airq-seed';

   where location_of_reading = 'center ice — 22-test-seed'),
  '=', 1,
  'air_quality_submissions: alpha row still exists after beta DELETE'
);

select * from finish();
rollback;
