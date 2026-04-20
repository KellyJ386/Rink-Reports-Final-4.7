-- 20260425000002_announcements_fns.sql
-- Communications RPCs + the `announcements_for_current_user()` SQL function that
-- is the single source of truth for feed ordering (list view + unread count +
-- notification landing all call the same function).
--
-- `announcements_for_current_user()` returns ONE row per announcement visible to
-- the caller, with a sort_bucket column:
--   1 = urgent + unread + non-archived + non-expired
--   2 = requires_acknowledgment but not yet acked (non-archived, non-expired)
--   3 = other unread (non-archived, non-expired)
--   4 = read + non-archived + non-expired
--   5 = archived or expired
--
-- Callers sort by (sort_bucket ASC, posted_at DESC) and slice.

-- ============================================================================
-- rpc_archive_announcement — author of own OR admin on admin_control_center
-- ============================================================================

create or replace function public.rpc_archive_announcement(
  p_announcement_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select id, facility_id, author_user_id, is_archived
  into v_row
  from public.announcements
  where id = p_announcement_id
  for update;

  if v_row.id is null then
    raise exception 'announcement % not found', p_announcement_id using errcode = 'P0002';
  end if;

  if v_row.is_archived then
    return;  -- idempotent; already archived
  end if;

  if not (
    public.is_platform_admin()
    or v_row.author_user_id = auth.uid()
    or (
      v_row.facility_id = public.current_facility_id()
      and public.has_module_access('admin_control_center', 'admin')
    )
  ) then
    raise exception 'not authorized to archive this announcement'
      using errcode = '42501';
  end if;

  update public.announcements
    set is_archived = true,
        archived_by = auth.uid(),
        archived_at = now()
    where id = p_announcement_id;

  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_row.facility_id,
    auth.uid(),
    'announcement.archived',
    'announcement',
    p_announcement_id,
    '{}'::jsonb
  );
end;
$$;

grant execute on function public.rpc_archive_announcement(uuid) to authenticated;

-- ============================================================================
-- announcements_for_current_user
-- ============================================================================

create or replace function public.announcements_for_current_user()
returns table (
  id                       uuid,
  title                    text,
  body                     text,
  priority                 text,
  posted_at                timestamptz,
  expires_at               timestamptz,
  is_archived              boolean,
  requires_acknowledgment  boolean,
  author_user_id           uuid,
  author_name              text,
  read_at                  timestamptz,
  acknowledged_at          timestamptz,
  sort_bucket              integer
)
language sql
stable
set search_path = public
as $$
  -- RLS on announcements scopes the base set automatically.
  select
    a.id,
    a.title,
    a.body,
    a.priority,
    a.posted_at,
    a.expires_at,
    a.is_archived,
    a.requires_acknowledgment,
    a.author_user_id,
    coalesce(u.full_name, u.email::text) as author_name,
    ar.read_at,
    ar.acknowledged_at,
    case
      when a.is_archived
        or (a.expires_at is not null and a.expires_at <= now())
        then 5
      when a.priority = 'urgent' and ar.read_at is null
        then 1
      when a.requires_acknowledgment
           and (ar.acknowledged_at is null or ar.read_at is null)
        then 2
      when ar.read_at is null
        then 3
      else 4
    end as sort_bucket
  from public.announcements a
  left join public.announcement_reads ar
    on ar.announcement_id = a.id and ar.user_id = auth.uid()
  left join public.users u on u.id = a.author_user_id;
$$;

grant execute on function public.announcements_for_current_user() to authenticated;

comment on function public.announcements_for_current_user() is
  'Single source of truth for the Communications feed ordering. RLS on announcements scopes the base set; caller orders by (sort_bucket asc, posted_at desc).';
