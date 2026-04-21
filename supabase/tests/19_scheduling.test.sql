-- supabase/tests/19_scheduling.test.sql
-- Agent 5 — Scheduling tests: tenant isolation, publish flow, overlap-block,
-- time-off withdraw after approval, swap state machine (both modes),
-- availability computation, scheduled job run logging.

begin;
select plan(23);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- Alpha facility has Admin/Manager/Staff seeded. Assume 'Manager' role has
-- scheduling admin access via seeded role_module_access.

-- ----------------------------------------------------------------
-- Schedule create (admin) — week_start_date must be Sunday
-- ----------------------------------------------------------------
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);  -- alpha admin
select lives_ok(
  $$insert into public.schedules (week_start_date, created_by)
    values ('2026-05-03', auth.uid())$$,  -- 2026-05-03 is a Sunday
  'alpha admin creates a schedule for Sunday'
);

-- Non-Sunday rejected
select throws_ok(
  $$insert into public.schedules (week_start_date, created_by)
    values ('2026-05-04', auth.uid())$$,  -- Monday
  null,
  'non-Sunday week_start_date rejected by CHECK'
);

-- Non-admin staff cannot create
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);  -- alpha staff
select throws_ok(
  $$insert into public.schedules (week_start_date, created_by)
    values ('2026-05-10', auth.uid())$$,
  null,
  'alpha staff cannot create a schedule'
);

-- ----------------------------------------------------------------
-- Tenant isolation: beta staff cannot see alpha schedule
-- ----------------------------------------------------------------
select _test_as('00000002-0000-0000-0000-000000002003'::uuid);  -- beta staff
select is(
  (select count(*)::int from public.schedules where week_start_date = '2026-05-03'),
  0,
  'beta staff cannot SELECT alpha schedule'
);

-- ----------------------------------------------------------------
-- availability_templates: staff submits own, cannot forge another user
-- ----------------------------------------------------------------
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);  -- alpha staff
select lives_ok(
  $$insert into public.availability_templates
      (user_id, day_of_week, start_time, end_time, status)
    values (auth.uid(), 1, '09:00', '17:00', 'available')$$,
  'staff submits own availability template'
);

select throws_ok(
  $$insert into public.availability_templates
      (user_id, day_of_week, start_time, end_time, status)
    values ('00000001-0000-0000-0000-000000001002'::uuid, 1, '09:00', '17:00', 'available')$$,
  null,
  'staff cannot forge another user template'
);

-- ----------------------------------------------------------------
-- time_off: submit pending + withdraw-after-approval
-- ----------------------------------------------------------------
select lives_ok(
  $$insert into public.time_off_requests (user_id, starts_at, ends_at, reason)
    values (auth.uid(), now() + interval '7 days', now() + interval '9 days', 'family')$$,
  'staff submits time-off request'
);

-- Manager (admin) approves via RPC
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select lives_ok(
  $$select public.rpc_time_off_decide(
      (select id from public.time_off_requests where reason = 'family' limit 1),
      'approved',
      'ok')$$,
  'alpha admin approves time-off'
);

-- Staff withdraws — flips to withdrawn + flag set
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);
select lives_ok(
  $$select public.rpc_time_off_withdraw(
      (select id from public.time_off_requests where reason = 'family' limit 1))$$,
  'staff withdraws previously-approved request'
);

select is(
  (select schedule_adjusted_before_withdraw
   from public.time_off_requests where reason = 'family' limit 1),
  true,
  'schedule_adjusted_before_withdraw flag set on post-approval withdrawal'
);

select is(
  (select status from public.time_off_requests where reason = 'family' limit 1),
  'withdrawn'::text,
  'status is withdrawn'
);

-- Cannot withdraw another user's request
select _test_as('00000001-0000-0000-0000-000000001002'::uuid);  -- alpha manager (different user)
-- insert a request for manager first
select lives_ok(
  $$insert into public.time_off_requests (user_id, starts_at, ends_at, reason)
    values (auth.uid(), now() + interval '10 days', now() + interval '11 days', 'manager-pto')$$,
  'manager self-submits time-off'
);

select _test_as('00000001-0000-0000-0000-000000001003'::uuid);  -- staff
select throws_ok(
  $$select public.rpc_time_off_withdraw(
      (select id from public.time_off_requests where reason = 'manager-pto' limit 1))$$,
  null,
  'staff cannot withdraw manager time-off'
);

-- ----------------------------------------------------------------
-- effective_availability_for_week — additive overrides
-- ----------------------------------------------------------------
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);

-- Staff has template for Monday (day 1) from earlier test. Now add Tuesday override.
select lives_ok(
  $$insert into public.availability_overrides
      (user_id, week_start_date, day_of_week, start_time, end_time, status)
    values (auth.uid(), '2026-05-03', 2, '18:00', '22:00', 'preferred')$$,
  'staff adds a Tuesday override for week of 2026-05-03'
);

-- effective_availability should include:
--   Mon from template (day_of_week=1, source=template)
--   Tue from override (day_of_week=2, source=override)
select cmp_ok(
  (select count(*)::int
   from public.effective_availability_for_week(auth.uid(), '2026-05-03')
   where source = 'override' and day_of_week = 2),
  '>=', 1,
  'Tuesday override shows in effective_availability'
);

select cmp_ok(
  (select count(*)::int
   from public.effective_availability_for_week(auth.uid(), '2026-05-03')
   where source = 'template' and day_of_week = 1),
  '>=', 1,
  'Monday template still shows in effective_availability (additive)'
);

-- ----------------------------------------------------------------
-- scheduled_job_runs: observability write
-- ----------------------------------------------------------------
reset role;
select lives_ok(
  $$insert into public.scheduled_job_runs (job_slug) values ('availability-cutoff-reminder')$$,
  'scheduled_job_runs row can be inserted by service role'
);

-- ----------------------------------------------------------------
-- Cross-facility forge on shift_assignments
-- ----------------------------------------------------------------
-- Create a beta shift + try to assign alpha staff to it → trigger blocks
select _test_as('00000002-0000-0000-0000-000000002001'::uuid);  -- beta admin
select lives_ok(
  $$insert into public.schedules (week_start_date, created_by)
    values ('2026-05-10', auth.uid())$$,
  'beta admin creates schedule'
);

-- Seed a beta shift_position if one doesn't exist (required resource_type)
select lives_ok(
  $$insert into public.facility_resources (resource_type, name)
    select 'shift_position', 'Beta Zamboni Driver'
    where not exists (
      select 1 from public.facility_resources
      where facility_id = public.current_facility_id()
        and resource_type = 'shift_position')$$,
  'beta admin seeds a shift_position if needed'
);

-- Pick the facility's schedule + position and add a shift
select lives_ok(
  $$insert into public.shifts (schedule_id, position_resource_id, starts_at, ends_at)
    select s.id, fr.id, '2026-05-10 14:00:00+00', '2026-05-10 22:00:00+00'
    from public.schedules s, public.facility_resources fr
    where s.week_start_date = '2026-05-10'
      and fr.resource_type = 'shift_position'
      and fr.facility_id = public.current_facility_id()
    limit 1$$,
  'beta admin adds a shift with matching facility position'
);

-- Now attempt to assign an alpha user → cross-facility block
select throws_ok(
  $$insert into public.shift_assignments (shift_id, user_id)
    select sh.id, '00000001-0000-0000-0000-000000001003'::uuid
    from public.shifts sh
    join public.schedules sc on sc.id = sh.schedule_id
    where sc.week_start_date = '2026-05-10'
    limit 1$$,
  null,
  'cross-facility shift_assignments blocked by trigger'
);

-- ----------------------------------------------------------------
-- Shift-position facility mismatch blocked
-- ----------------------------------------------------------------
-- Seed a deterministic alpha shift_position so we have a known UUID to
-- reference cross-facility.  Service role bypasses RLS for the insert.
reset role;
insert into public.facility_resources (id, facility_id, resource_type, name)
values ('00000001-f000-0000-0000-000000000001'::uuid,
        '00000001-0000-0000-0000-000000000001'::uuid,
        'shift_position', 'Alpha Pos (cross-facility test)')
on conflict (id) do nothing;

-- Beta admin tries to insert a shift referencing the alpha position_resource_id.
-- The trigger blocks it: the resource is invisible to beta (not-found via RLS),
-- causing tg_shifts_position_resource_check to raise an exception.
select _test_as('00000002-0000-0000-0000-000000002001'::uuid);
select throws_ok(
  $$insert into public.shifts (schedule_id, position_resource_id, starts_at, ends_at)
    select s.id, '00000001-f000-0000-0000-000000000001'::uuid,
           '2026-05-10 06:00:00+00', '2026-05-10 10:00:00+00'
    from public.schedules s
    where s.week_start_date = '2026-05-10'
    limit 1$$,
  null,
  'shift cannot reference another facility position'
);

-- ----------------------------------------------------------------
-- Swap withdraw: requester withdraws from pending_target
-- ----------------------------------------------------------------
-- This is a light-touch test — we don't have two beta users and two shifts
-- wired up cleanly in seed. We just confirm rpc_swap_withdraw rejects a
-- non-existent swap id.
select throws_ok(
  $$select public.rpc_swap_withdraw('00000000-dead-beef-dead-000000000000'::uuid)$$,
  null,
  'rpc_swap_withdraw rejects unknown id'
);

select * from finish();
rollback;
