-- supabase/tests/17_agent_7.test.sql
-- Agent 7 tests: notifications RLS + publish_notification, impersonation session
-- var + audit_log auto-populate, billing_events append-only behavior.

begin;
select plan(17);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- ----------------------------------------------------------------
-- Notifications: publish_notification works; users see only their own
-- ----------------------------------------------------------------

-- Platform admin publishes to an alpha user
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select lives_ok(
  $$select public.publish_notification(
      '00000001-0000-0000-0000-000000001002'::uuid,
      'schedule.published',
      '{"schedule_id":"abc","week_start_date":"2026-04-20"}'::jsonb
    )$$,
  'platform admin publishes notification to alpha manager'
);

-- Alpha manager sees their notification
select _test_as('00000001-0000-0000-0000-000000001002'::uuid);
select cmp_ok(
  (select count(*)::int from public.notifications where user_id = auth.uid()),
  '>=',
  1,
  'alpha manager sees at least one notification'
);

-- Alpha staff does NOT see alpha manager's notifications
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);
select is(
  (select count(*)::int from public.notifications
   where user_id = '00000001-0000-0000-0000-000000001002'::uuid),
  0,
  'alpha staff cannot see alpha manager notifications'
);

-- Mark read succeeds for own row
select _test_as('00000001-0000-0000-0000-000000001002'::uuid);
select lives_ok(
  $$update public.notifications set read_at = now()
    where user_id = auth.uid() and read_at is null$$,
  'alpha manager marks own notifications read'
);

-- Mark read fails if attempting to change other columns
select throws_ok(
  $$update public.notifications set kind = 'tampered'
    where user_id = auth.uid()$$,
  null,
  'attempting to change non-read_at column fails'
);

-- publish_notification rejects unknown user
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select throws_ok(
  $$select public.publish_notification(
      '99999999-0000-0000-0000-000000000000'::uuid,
      'schedule.published',
      '{}'::jsonb
    )$$,
  null,
  'publish_notification rejects unknown user'
);

-- ----------------------------------------------------------------
-- Impersonation: set_request_vars + audit_log auto-populate
-- ----------------------------------------------------------------

-- Platform admin starts impersonation
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select lives_ok(
  $$select public.rpc_start_impersonation('00000001-0000-0000-0000-000000000001'::uuid)$$,
  'platform admin starts impersonation of alpha'
);

-- Impersonation session row exists
select is(
  (select count(*)::int from public.impersonation_sessions
   where platform_admin_user_id = auth.uid() and ended_at is null),
  1,
  'active impersonation session row exists'
);

-- Cannot impersonate into platform operations facility
select throws_ok(
  $$select public.rpc_start_impersonation(public.platform_facility_id())$$,
  null,
  'cannot impersonate into platform operations facility'
);

-- Set session vars for subsequent queries
select lives_ok(
  $$select public.rpc_set_request_vars(
      '00000001-0000-0000-0000-000000000001'::uuid,
      auth.uid()
    )$$,
  'set_request_vars works for platform admin'
);

-- current_facility_id() now returns alpha
select is(
  public.current_facility_id(),
  '00000001-0000-0000-0000-000000000001'::uuid,
  'current_facility_id returns impersonated facility'
);

-- Insert an audit_log row; trigger should auto-populate actor_impersonator_id
select lives_ok(
  $$insert into public.audit_log
      (facility_id, actor_user_id, action, entity_type, metadata)
    values (
      '00000001-0000-0000-0000-000000000001'::uuid,
      auth.uid(),
      'test.during_impersonation',
      'test',
      '{}'::jsonb
    )$$,
  'audit_log insert during impersonation'
);

-- actor_impersonator_id populated by trigger
select is(
  (select actor_impersonator_id from public.audit_log
   where action = 'test.during_impersonation'
   order by created_at desc limit 1),
  (select auth.uid()),
  'audit_log trigger auto-populated actor_impersonator_id from session var'
);

-- Non-platform-admin gets silent noop from set_request_vars
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);  -- alpha admin, not platform admin
select lives_ok(
  $$select public.rpc_set_request_vars(
      '00000002-0000-0000-0000-000000000002'::uuid,
      auth.uid()
    )$$,
  'set_request_vars is silent noop for non-platform-admin'
);

-- current_facility_id() still returns alpha admin's own facility (impersonation ignored)
select is(
  public.current_facility_id(),
  '00000001-0000-0000-0000-000000000001'::uuid,
  'non-platform-admin current_facility_id unaffected by forged impersonation attempt'
);

-- Stop impersonation as platform admin
select _test_as('00000000-0000-0000-0000-000000000001'::uuid);
select lives_ok(
  $$select public.rpc_stop_impersonation()$$,
  'platform admin stops impersonation'
);

-- ----------------------------------------------------------------
-- billing_events append-only
-- ----------------------------------------------------------------

-- Platform admin inserts an event
select lives_ok(
  $$insert into public.billing_events (stripe_event_id, event_type, payload)
    values ('evt_test_0001', 'test.type', '{"foo":"bar"}'::jsonb)$$,
  'platform admin inserts billing_event'
);

-- UPDATE of event_type blocked
select throws_ok(
  $$update public.billing_events set event_type = 'tampered'
    where stripe_event_id = 'evt_test_0001'$$,
  null,
  'cannot UPDATE event_type on billing_events'
);

-- But processed_at update is allowed
select lives_ok(
  $$update public.billing_events set processed_at = now()
    where stripe_event_id = 'evt_test_0001'$$,
  'can UPDATE processed_at on billing_events'
);

select * from finish();
rollback;
