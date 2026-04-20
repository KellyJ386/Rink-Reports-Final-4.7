-- 20260426000004_avail_cutoff_reminder_index.sql
-- Agent 5 — Partial expression index supporting the
-- /api/jobs/availability-cutoff-reminder dedup NOT EXISTS subquery.
--
-- The job asks: "for each user who hasn't submitted availability for
-- next-week-start-W, have we already notified them in the last 24h?"
--
-- The dedup predicate:
--   EXISTS (
--     SELECT 1 FROM notifications n
--     WHERE n.user_id = <candidate>
--       AND n.kind = 'availability.cutoff_approaching'
--       AND (n.payload->>'week_start_date')::date = <W>
--       AND n.created_at > now() - interval '24 hours'
--   )
--
-- Partial index keyed on kind + week_start_date expression + created_at
-- collapses the search to the reminder volume for that week only.

create index if not exists notifications_availability_cutoff_idx
  on public.notifications (
    user_id,
    (payload->>'week_start_date'),
    created_at desc
  )
  where kind = 'availability.cutoff_approaching';
