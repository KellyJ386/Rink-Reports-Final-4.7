-- 20260425000003_scheduled_job_runs.sql
-- Observability pattern for every scheduled job.
--
-- Every job handler writes exactly one row per invocation:
--   - Start: insert {job_slug, started_at}
--   - End:   update {ended_at, duration_ms, rows_processed, rows_succeeded, rows_failed, error_if_any}
--
-- Retrofit target: Agent 7's 6 scheduled jobs (trial-expiration-check,
-- trial-ending-notification, past-due-notification, stripe-webhook-retry,
-- availability-cutoff-reminder, ack-reminder) wrap their bodies in the
-- logScheduledJobRun() helper so the pattern is uniform from the start.
--
-- Also ships an expression index on notifications for the ack-reminder
-- NOT EXISTS subquery. Partial index keyed to kind='announcement.ack_reminder'
-- stays small (grows only with reminder volume).

create table if not exists public.scheduled_job_runs (
  id               uuid primary key default gen_random_uuid(),
  job_slug         text not null,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  duration_ms      integer,
  rows_processed   integer not null default 0,
  rows_succeeded   integer not null default 0,
  rows_failed      integer not null default 0,
  error_if_any     text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists scheduled_job_runs_slug_started_idx
  on public.scheduled_job_runs (job_slug, started_at desc);

create index if not exists scheduled_job_runs_errors_idx
  on public.scheduled_job_runs (started_at desc)
  where error_if_any is not null;

alter table public.scheduled_job_runs enable row level security;

-- SELECT: platform admins only (/platform-admin/health surfaces this)
drop policy if exists scheduled_job_runs_select on public.scheduled_job_runs;
create policy scheduled_job_runs_select on public.scheduled_job_runs
  for select to authenticated
  using (public.is_platform_admin());

-- INSERT/UPDATE via service role only (jobs run with SUPABASE_SERVICE_ROLE_KEY
-- which bypasses RLS). No policies needed for authenticated writes.

-- Prevent tampering: no UPDATE of started_at / job_slug after insert.
create or replace function public.tg_scheduled_job_runs_immutable_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.job_slug   is distinct from old.job_slug
     or new.started_at is distinct from old.started_at
     or new.created_at is distinct from old.created_at then
    raise exception 'scheduled_job_runs: job_slug / started_at / created_at are immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists scheduled_job_runs_immutable on public.scheduled_job_runs;
create trigger scheduled_job_runs_immutable
  before update on public.scheduled_job_runs
  for each row execute function public.tg_scheduled_job_runs_immutable_fields();

comment on table public.scheduled_job_runs is
  'One row per scheduled-job invocation. job_slug + started_at immutable; end fields populated on completion. Use lib/scheduled-jobs/run-logger.ts to avoid hand-rolling the row lifecycle.';

-- ============================================================================
-- Notifications expression index for the ack-reminder NOT EXISTS query
-- ============================================================================

-- Agent 8's /api/jobs/ack-reminder issues:
--   SELECT ... FROM announcements a JOIN announcement_reads ar ...
--     WHERE NOT EXISTS (
--       SELECT 1 FROM notifications n
--       WHERE n.user_id = ar.user_id
--         AND n.kind = 'announcement.ack_reminder'
--         AND (n.payload->>'announcement_id')::uuid = a.id
--         AND n.created_at > now() - interval '24 hours'
--     )
--
-- The (payload->>'announcement_id') expression needs an index to stay fast at
-- volume. Partial index on kind keeps the index small (only ack_reminder rows).

create index if not exists notifications_ack_reminder_announcement_idx
  on public.notifications (user_id, (payload->>'announcement_id'), created_at desc)
  where kind = 'announcement.ack_reminder';
