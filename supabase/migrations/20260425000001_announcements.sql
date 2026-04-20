-- 20260425000001_announcements.sql
-- Communications module: announcements + per-user read/ack tracking.
--
-- Audience targeting: 'all_staff' | 'specific_roles' (with target_role_ids uuid[]).
-- Check constraint enforces the brief's rule: specific_roles requires non-empty array.
--
-- Key decisions:
--   * Author can edit content only before any read exists (RLS USING clause)
--   * Archive path is the rpc_archive_announcement RPC (handles author-of-own +
--     admin-of-anyone in one AuthZ block)
--   * Read/ack upsert: ON CONFLICT preserves original read_at as historical truth
--   * Partial index on announcement_reads(acknowledged_at, read_at) accelerates
--     the Agent 7 ack-reminder job

create table if not exists public.announcements (
  id                       uuid primary key default gen_random_uuid(),
  facility_id              uuid not null default public.current_facility_id()
                             references public.facilities(id) on delete cascade,
  author_user_id           uuid not null references public.users(id) on delete restrict,
  title                    text not null check (length(title) between 1 and 200),
  body                     text not null check (length(body) between 1 and 20000),
  priority                 text not null check (priority in ('normal', 'important', 'urgent')),
  target_audience          text not null check (target_audience in ('all_staff', 'specific_roles')),
  target_role_ids          uuid[],
  requires_acknowledgment  boolean not null default false,
  posted_at                timestamptz not null default now(),
  expires_at               timestamptz,
  is_archived              boolean not null default false,
  archived_by              uuid references public.users(id) on delete set null,
  archived_at              timestamptz,
  idempotency_key          text,
  created_at               timestamptz not null default now(),

  constraint announcements_audience_targets_chk check (
    target_audience = 'all_staff'
    or (
      target_audience = 'specific_roles'
      and target_role_ids is not null
      and array_length(target_role_ids, 1) > 0
    )
  ),
  constraint announcements_archive_consistency_chk check (
    (is_archived = false and archived_by is null and archived_at is null)
    or (is_archived = true and archived_at is not null)
  )
);

create index if not exists announcements_facility_feed_idx
  on public.announcements (facility_id, posted_at desc)
  where is_archived = false;

create index if not exists announcements_facility_author_idx
  on public.announcements (facility_id, author_user_id, posted_at desc);

create index if not exists announcements_facility_urgent_idx
  on public.announcements (facility_id, posted_at desc)
  where priority = 'urgent' and is_archived = false;

create unique index if not exists announcements_idempotency_key
  on public.announcements (facility_id, idempotency_key)
  where idempotency_key is not null;

alter table public.announcements enable row level security;

-- Authors + admins + target audience (with Communications read access) see announcements
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
  for select to authenticated
  using (
    public.is_platform_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_access('admin_control_center', 'admin')
        or author_user_id = auth.uid()
        or (
          public.has_module_access('communications', 'read')
          and (
            target_audience = 'all_staff'
            or target_role_ids && (
              select coalesce(array_agg(role_id), array[]::uuid[])
              from public.user_roles where user_id = auth.uid()
            )
          )
        )
      )
    )
  );

drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('communications', 'write')
      and author_user_id = auth.uid()
    )
  );

-- Content edits: author only, only if no reads exist. Archive goes through the RPC.
drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements
  for update to authenticated
  using (
    public.is_platform_admin()
    or (
      author_user_id = auth.uid()
      and not exists (
        select 1 from public.announcement_reads
        where announcement_id = announcements.id
      )
    )
  )
  with check (
    public.is_platform_admin()
    or author_user_id = auth.uid()
  );

-- No DELETE policy — archive (via RPC) is the only retirement path.

comment on table public.announcements is
  'Facility-wide + role-targeted announcements. Content edits blocked after first read; retire via rpc_archive_announcement.';

-- ============================================================================
-- announcement_reads
-- ============================================================================

create table if not exists public.announcement_reads (
  id                uuid primary key default gen_random_uuid(),
  announcement_id   uuid not null references public.announcements(id) on delete cascade,
  user_id           uuid not null references public.users(id) on delete cascade,
  read_at           timestamptz not null default now(),
  acknowledged_at   timestamptz,

  constraint announcement_reads_unique unique (announcement_id, user_id)
);

create index if not exists announcement_reads_user_read_idx
  on public.announcement_reads (user_id, read_at desc);

-- Drives Agent 7's ack-reminder job: find rows that have been read but not acked.
create index if not exists announcement_reads_pending_ack_idx
  on public.announcement_reads (acknowledged_at, read_at)
  where acknowledged_at is null;

alter table public.announcement_reads enable row level security;

-- Users see their own. Authors + admins see reads on announcements they authored / manage.
drop policy if exists announcement_reads_select on public.announcement_reads;
create policy announcement_reads_select on public.announcement_reads
  for select to authenticated
  using (
    public.is_platform_admin()
    or user_id = auth.uid()
    or exists (
      select 1 from public.announcements a
      where a.id = announcement_reads.announcement_id
        and (
          a.author_user_id = auth.uid()
          or (
            a.facility_id = public.current_facility_id()
            and public.has_module_access('admin_control_center', 'admin')
          )
        )
    )
  );

drop policy if exists announcement_reads_insert on public.announcement_reads;
create policy announcement_reads_insert on public.announcement_reads
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists announcement_reads_update on public.announcement_reads;
create policy announcement_reads_update on public.announcement_reads
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No DELETE; reads are history.

comment on table public.announcement_reads is
  'One row per (announcement, user). read_at set on first open; acknowledged_at optional (only meaningful when announcement.requires_acknowledgment=true). Upsert preserves original read_at.';
