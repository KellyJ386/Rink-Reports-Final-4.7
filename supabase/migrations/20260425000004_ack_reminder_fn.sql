-- 20260425000004_ack_reminder_fn.sql
-- SQL helper that returns the set of (user, announcement) pairs needing an
-- ack-reminder notification this tick. Centralises the audience + dedup logic
-- so the /api/jobs/ack-reminder route stays thin.
--
-- Recipient set logic:
--   - target_audience = 'all_staff': every active user in the facility
--   - target_audience = 'specific_roles': DISTINCT user_ids joined through user_roles
--
-- Ack-reminder needed when:
--   - announcement.requires_acknowledgment = true
--   - announcement.is_archived = false
--   - announcement.expires_at IS NULL OR expires_at > now()
--   - announcement.posted_at < overdue_cutoff (typically now - 24h)
--   - announcement.posted_at > window_start (skip very old — honour window)
--   - no announcement_reads row for (user, announcement) with acknowledged_at set
--   - no ack_reminder notification for this (user, announcement) in the last 24h
--
-- Returns rows ordered by posted_at ASC (oldest first), capped at p_limit.

create or replace function public.ack_reminder_candidates(
  p_window_start  timestamptz,
  p_overdue_cutoff timestamptz,
  p_limit integer
)
returns table (
  user_id         uuid,
  announcement_id uuid,
  title           text,
  priority        text,
  posted_at       timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with eligible_announcements as (
    select a.id, a.facility_id, a.title, a.priority, a.posted_at,
           a.target_audience, a.target_role_ids
    from public.announcements a
    where a.requires_acknowledgment = true
      and a.is_archived = false
      and (a.expires_at is null or a.expires_at > now())
      and a.posted_at < p_overdue_cutoff
      and a.posted_at > p_window_start
  ),
  audience as (
    -- all_staff: every active user in the facility
    select ea.id as announcement_id, u.id as user_id, ea.title, ea.priority, ea.posted_at
    from eligible_announcements ea
    join public.users u on u.facility_id = ea.facility_id and u.active = true
    where ea.target_audience = 'all_staff'

    union

    -- specific_roles: distinct user_ids via user_roles
    select ea.id as announcement_id, ur.user_id, ea.title, ea.priority, ea.posted_at
    from eligible_announcements ea
    join public.user_roles ur on ur.role_id = any(ea.target_role_ids)
    join public.roles r on r.id = ur.role_id and r.facility_id = ea.facility_id
    where ea.target_audience = 'specific_roles'
  )
  select a.user_id, a.announcement_id, a.title, a.priority, a.posted_at
  from audience a
  where not exists (
    -- skip if user has already acknowledged
    select 1 from public.announcement_reads ar
    where ar.announcement_id = a.announcement_id
      and ar.user_id = a.user_id
      and ar.acknowledged_at is not null
  )
  and not exists (
    -- skip if we already sent an ack_reminder for this pair in the last 24h
    select 1 from public.notifications n
    where n.user_id = a.user_id
      and n.kind = 'announcement.ack_reminder'
      and (n.payload->>'announcement_id')::uuid = a.announcement_id
      and n.created_at > now() - interval '24 hours'
  )
  order by a.posted_at asc
  limit p_limit;
$$;

comment on function public.ack_reminder_candidates(timestamptz, timestamptz, integer) is
  'Set of (user, announcement) pairs needing an ack_reminder notification. Honors audience + dedup. Called by /api/jobs/ack-reminder.';

-- SECURITY DEFINER so the job can run without impersonating a specific user.
-- Callable only by service role in practice (the /api/jobs/ack-reminder route
-- uses createServiceClient()). No grants to authenticated role.
revoke all on function public.ack_reminder_candidates(timestamptz, timestamptz, integer) from public;
revoke all on function public.ack_reminder_candidates(timestamptz, timestamptz, integer) from authenticated;
