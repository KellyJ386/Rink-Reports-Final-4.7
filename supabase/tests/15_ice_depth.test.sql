-- supabase/tests/15_ice_depth.test.sql
-- Ice Depth module: template state machine, surface trigger, session flow,
-- readings upsert, RLS cross-facility isolation, publish guard against removing
-- point keys referenced by history.

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
-- Surface-type trigger: surface_resource_id must point to a 'surface' resource.
-- ----------------------------------------------------------------

select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select throws_ok(
  $$insert into public.ice_depth_templates
      (surface_resource_id, name, svg_key, current_points)
    select
      (select id from public.facility_resources
         where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
           and resource_type = 'compressor' limit 1),
      'wrong type', 'nhl', '[]'::jsonb$$,
  null,
  'cannot create template with a compressor resource as surface_resource_id'
);

-- Valid create
select lives_ok(
  $$insert into public.ice_depth_templates
      (surface_resource_id, name, svg_key, current_points)
    select
      (select id from public.facility_resources
         where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
           and resource_type = 'surface' and name = 'Main Rink' limit 1),
      'Main Rink weekly', 'nhl',
      '[{"key":"p1","label":"Crease","x_pct":10,"y_pct":50,"sort_order":1},
        {"key":"p2","label":"Center","x_pct":50,"y_pct":50,"sort_order":2}]'::jsonb$$,
  'alpha admin creates Ice Depth template for Main Rink'
);

-- ----------------------------------------------------------------
-- Template state machine
-- ----------------------------------------------------------------

-- Save a draft via RPC
select lives_ok(
  $$select public.rpc_save_ice_depth_template_draft(
      (select id from public.ice_depth_templates
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and name = 'Main Rink weekly' limit 1),
      '[{"key":"p1","label":"Crease","x_pct":10,"y_pct":50,"sort_order":1},
        {"key":"p2","label":"Center","x_pct":50,"y_pct":50,"sort_order":2},
        {"key":"p3","label":"Right","x_pct":90,"y_pct":50,"sort_order":3}]'::jsonb,
      null, null
    )$$,
  'alpha admin saves a draft adding a third point'
);

-- Version stays at 1 until publish
select is(
  (select version from public.ice_depth_templates
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
     and name = 'Main Rink weekly' limit 1),
  1,
  'save_draft does not bump version'
);

-- Publish → version 2, snapshot to history, draft cleared
select lives_ok(
  $$select * from public.rpc_publish_ice_depth_template(
      (select id from public.ice_depth_templates
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and name = 'Main Rink weekly' limit 1)
    )$$,
  'publish succeeds'
);

select is(
  (select version from public.ice_depth_templates
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
     and name = 'Main Rink weekly' limit 1),
  2,
  'version bumped to 2 after publish'
);

select cmp_ok(
  (select count(*)::int from public.ice_depth_template_history
   where template_id = (select id from public.ice_depth_templates
     where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
       and name = 'Main Rink weekly' limit 1)),
  '>=',
  1,
  'v1 snapshot appears in history'
);

-- History is append-only
select throws_ok(
  $$update public.ice_depth_template_history set points = '[]'::jsonb
    where template_id = (select id from public.ice_depth_templates
      where facility_id = '00000001-0000-0000-0000-000000000001'::uuid limit 1)$$,
  null,
  'ice_depth_template_history UPDATE blocked by trigger'
);

-- ----------------------------------------------------------------
-- Session flow
-- ----------------------------------------------------------------

-- Manager starts a session
select _test_as('00000001-0000-0000-0000-000000001002'::uuid);
select lives_ok(
  $$insert into public.ice_depth_sessions
      (submitted_by, template_id, surface_resource_id, form_schema_version, idempotency_key, status)
    select
      '00000001-0000-0000-0000-000000001002',
      t.id,
      t.surface_resource_id,
      t.version,
      'idem-ice-depth-0001',
      'in_progress'
    from public.ice_depth_templates t
    where t.facility_id = '00000001-0000-0000-0000-000000000001'::uuid
      and t.name = 'Main Rink weekly' limit 1$$,
  'alpha manager starts an ice depth session'
);

-- Duplicate idempotency_key rejected
select throws_ok(
  $$insert into public.ice_depth_sessions
      (submitted_by, template_id, surface_resource_id, form_schema_version, idempotency_key, status)
    select
      '00000001-0000-0000-0000-000000001002',
      t.id, t.surface_resource_id, t.version,
      'idem-ice-depth-0001', 'in_progress'
    from public.ice_depth_templates t
    where t.facility_id = '00000001-0000-0000-0000-000000000001'::uuid
      and t.name = 'Main Rink weekly' limit 1$$,
  '23505',
  'duplicate session idempotency_key rejected'
);

-- Upsert readings for the 3 points
select lives_ok(
  $$insert into public.ice_depth_readings (session_id, point_key, depth_mm)
    select s.id, p.key, 42.0
    from public.ice_depth_sessions s,
         jsonb_array_elements((select current_points from public.ice_depth_templates
                                 where id = s.template_id)) as p(val),
         lateral (select p.val->>'key' as key) as p(key)
    where s.idempotency_key = 'idem-ice-depth-0001'$$,
  'insert readings for all 3 template points'
);

-- Duplicate (session_id, point_key) upsert-equivalent: plain duplicate rejected
select throws_ok(
  $$insert into public.ice_depth_readings (session_id, point_key, depth_mm)
    select s.id, 'p1', 50.0
    from public.ice_depth_sessions s
    where s.idempotency_key = 'idem-ice-depth-0001'$$,
  '23505',
  'duplicate reading (session_id, point_key) rejected without ON CONFLICT'
);

-- But ON CONFLICT upsert works
select lives_ok(
  $$insert into public.ice_depth_readings (session_id, point_key, depth_mm)
    select s.id, 'p1', 50.0
    from public.ice_depth_sessions s
    where s.idempotency_key = 'idem-ice-depth-0001'
    on conflict (session_id, point_key) do update set depth_mm = excluded.depth_mm$$,
  'ON CONFLICT upsert overrides previous reading'
);

-- Complete the session via RPC
select lives_ok(
  $$select * from public.rpc_complete_ice_depth_session(
      (select id from public.ice_depth_sessions
       where idempotency_key = 'idem-ice-depth-0001' limit 1)
    )$$,
  'complete session succeeds when all points have readings'
);

-- Session is now completed
select is(
  (select status from public.ice_depth_sessions
   where idempotency_key = 'idem-ice-depth-0001' limit 1),
  'completed',
  'status flipped to completed'
);

-- ----------------------------------------------------------------
-- Publish guard: cannot drop point keys referenced by history
-- ----------------------------------------------------------------

-- Try to save a draft that removes p1 (which has a reading in the completed session)
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select lives_ok(
  $$select public.rpc_save_ice_depth_template_draft(
      (select id from public.ice_depth_templates
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and name = 'Main Rink weekly' limit 1),
      '[{"key":"p2","label":"Center","x_pct":50,"y_pct":50,"sort_order":1},
        {"key":"p3","label":"Right","x_pct":90,"y_pct":50,"sort_order":2}]'::jsonb,
      null, null
    )$$,
  'save draft that drops p1'
);

-- Publish should reject
select throws_ok(
  $$select * from public.rpc_publish_ice_depth_template(
      (select id from public.ice_depth_templates
       where facility_id = '00000001-0000-0000-0000-000000000001'::uuid
         and name = 'Main Rink weekly' limit 1)
    )$$,
  null,
  'publish rejects drafts that drop point keys referenced by historical readings'
);

-- ----------------------------------------------------------------
-- RLS: beta cannot see alpha
-- ----------------------------------------------------------------

select _test_as('00000002-0000-0000-0000-000000002003'::uuid);
select is(
  (select count(*)::int from public.ice_depth_templates
   where facility_id = '00000001-0000-0000-0000-000000000001'::uuid),
  0,
  'beta staff cannot see alpha ice depth templates'
);

select * from finish();
rollback;
