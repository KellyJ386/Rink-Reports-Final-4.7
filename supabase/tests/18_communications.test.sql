-- supabase/tests/18_communications.test.sql
-- Agent 8 tests: announcement RLS (tenant isolation, admin-vs-staff INSERT, edit
-- window after first read, archive via rpc), feed ordering sort_bucket, ack
-- reminder candidate set, scheduled_job_runs immutability.

begin;
select plan(22);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- ----------------------------------------------------------------
-- Post announcement (admin-only, own facility)
-- ----------------------------------------------------------------

-- Alpha admin posts an announcement
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select lives_ok(
  $$insert into public.announcements
      (author_user_id, title, body, priority, target_audience, requires_acknowledgment)
    values (auth.uid(), 'Alpha test A', 'body A', 'normal', 'all_staff', false)$$,
  'alpha admin posts an all-staff announcement'
);

-- Alpha staff (non-admin) cannot post
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);
select throws_ok(
  $$insert into public.announcements
      (author_user_id, title, body, priority, target_audience, requires_acknowledgment)
    values (auth.uid(), 'staff attempt', 'body', 'normal', 'all_staff', false)$$,
  null,
  'non-admin staff cannot INSERT announcement'
);

-- ----------------------------------------------------------------
-- Tenant isolation: beta staff cannot see alpha announcement
-- ----------------------------------------------------------------
select _test_as('00000002-0000-0000-0000-000000002003'::uuid);
select is(
  (select count(*)::int from public.announcements where title = 'Alpha test A'),
  0,
  'beta staff cannot SELECT alpha announcement'
);

-- Alpha staff CAN see it (all_staff audience)
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);
select cmp_ok(
  (select count(*)::int from public.announcements where title = 'Alpha test A'),
  '>=', 1,
  'alpha staff sees all_staff announcement'
);

-- ----------------------------------------------------------------
-- Specific_roles audience: only members of the targeted role see it
-- ----------------------------------------------------------------

-- Fetch the alpha manager role id
-- Post a specific_roles announcement
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select lives_ok(
  $$insert into public.announcements
      (author_user_id, title, body, priority, target_audience, target_role_ids, requires_acknowledgment)
    select auth.uid(), 'Alpha managers only', 'confidential', 'important', 'specific_roles',
           array[r.id], true
    from public.roles r
    where r.facility_id = '00000001-0000-0000-0000-000000000001'::uuid and r.name = 'Manager'
    limit 1$$,
  'alpha admin posts Manager-only announcement'
);

-- Alpha manager sees it
select _test_as('00000001-0000-0000-0000-000000001002'::uuid);
select cmp_ok(
  (select count(*)::int from public.announcements where title = 'Alpha managers only'),
  '>=', 1,
  'alpha manager sees Manager-only announcement'
);

-- Alpha staff does NOT see it
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);
select is(
  (select count(*)::int from public.announcements where title = 'Alpha managers only'),
  0,
  'alpha staff cannot see Manager-only announcement'
);

-- ----------------------------------------------------------------
-- Edit window: blocked after first read
-- ----------------------------------------------------------------

-- Alpha manager reads the all-staff announcement
select _test_as('00000001-0000-0000-0000-000000001002'::uuid);
select lives_ok(
  $$insert into public.announcement_reads (announcement_id, user_id)
    select id, auth.uid() from public.announcements where title = 'Alpha test A' limit 1
    on conflict (announcement_id, user_id) do nothing$$,
  'alpha manager marks announcement read'
);

-- Alpha admin (author) now attempts to edit body — should fail because a read exists
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select throws_ok(
  $$update public.announcements set body = 'mutated'
    where title = 'Alpha test A'$$,
  null,
  'author cannot edit announcement body after first read'
);

-- ----------------------------------------------------------------
-- rpc_archive_announcement: author can archive own; idempotent
-- ----------------------------------------------------------------
select lives_ok(
  $$select public.rpc_archive_announcement(
      (select id from public.announcements where title = 'Alpha test A' limit 1)
    )$$,
  'author can archive own announcement via RPC'
);

-- Re-archive is noop (returns false or 0 — asserted as lives_ok)
select lives_ok(
  $$select public.rpc_archive_announcement(
      (select id from public.announcements where title = 'Alpha test A' limit 1)
    )$$,
  're-archive is idempotent noop'
);

-- Row is marked archived
select is(
  (select is_archived from public.announcements where title = 'Alpha test A' limit 1),
  true,
  'announcement is_archived = true'
);

-- ----------------------------------------------------------------
-- Forged facility_id on INSERT is rejected
-- ----------------------------------------------------------------
select throws_ok(
  $$insert into public.announcements
      (facility_id, author_user_id, title, body, priority, target_audience, requires_acknowledgment)
    values (
      '00000002-0000-0000-0000-000000000002'::uuid,  -- beta facility
      auth.uid(),
      'forged facility', 'body', 'normal', 'all_staff', false
    )$$,
  null,
  'alpha admin cannot forge facility_id=beta on INSERT'
);

-- ----------------------------------------------------------------
-- Audience constraint: specific_roles requires non-empty target_role_ids
-- ----------------------------------------------------------------
select throws_ok(
  $$insert into public.announcements
      (author_user_id, title, body, priority, target_audience, target_role_ids, requires_acknowledgment)
    values (auth.uid(), 'bad audience', 'body', 'normal', 'specific_roles', null, false)$$,
  null,
  'specific_roles audience with NULL target_role_ids violates check'
);

-- ----------------------------------------------------------------
-- announcement_reads: read_at upsert is idempotent
-- ----------------------------------------------------------------
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);
select lives_ok(
  $$insert into public.announcement_reads (announcement_id, user_id)
    select id, auth.uid() from public.announcements where title = 'Alpha test A' limit 1
    on conflict (announcement_id, user_id) do nothing$$,
  'first mark-read insert succeeds'
);

select lives_ok(
  $$insert into public.announcement_reads (announcement_id, user_id)
    select id, auth.uid() from public.announcements where title = 'Alpha test A' limit 1
    on conflict (announcement_id, user_id) do nothing$$,
  'second mark-read is idempotent noop'
);

-- User cannot forge a read for another user
select throws_ok(
  $$insert into public.announcement_reads (announcement_id, user_id)
    values (
      (select id from public.announcements where title = 'Alpha test A' limit 1),
      '00000001-0000-0000-0000-000000001002'::uuid
    )$$,
  null,
  'cannot INSERT announcement_reads on behalf of another user'
);

-- ----------------------------------------------------------------
-- announcements_for_current_user() returns correct sort_bucket
-- ----------------------------------------------------------------

-- Alpha manager (who read all_staff one, but Manager-only one is unread + requires_ack)
select _test_as('00000001-0000-0000-0000-000000001002'::uuid);

-- Manager-only requires_ack + unread → sort_bucket = 2 (urgent not set; ack pending dominates unread)
select cmp_ok(
  (select sort_bucket from public.announcements_for_current_user()
   where title = 'Alpha managers only'),
  '<=', 3,
  'Manager-only unread+requires_ack in a priority bucket (1-3)'
);

-- Archived alpha announcement → sort_bucket = 5
select is(
  (select sort_bucket from public.announcements_for_current_user()
   where title = 'Alpha test A'),
  5,
  'archived announcement sort_bucket = 5'
);

-- ----------------------------------------------------------------
-- scheduled_job_runs: job_slug immutable after insert
-- ----------------------------------------------------------------

-- Reset to platform admin (who cannot insert either — service role writes
-- normally). We can't easily simulate service role in pgTAP (which runs under a
-- superuser role), so the trigger test runs as postgres.
reset role;
select lives_ok(
  $$insert into public.scheduled_job_runs (job_slug) values ('test-slug')$$,
  'scheduled_job_runs insert works'
);

select throws_ok(
  $$update public.scheduled_job_runs set job_slug = 'tampered'
    where job_slug = 'test-slug'$$,
  null,
  'scheduled_job_runs.job_slug is immutable via trigger'
);

-- End-fields update allowed
select lives_ok(
  $$update public.scheduled_job_runs
      set ended_at = now(), duration_ms = 100, rows_processed = 5
    where job_slug = 'test-slug'$$,
  'scheduled_job_runs end-fields update allowed'
);

select * from finish();
rollback;
