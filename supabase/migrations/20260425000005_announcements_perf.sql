-- 20260425000005_announcements_perf.sql
-- Performance pass on Agent 8's tables driven by Supabase advisor findings.
--
-- 1. Rewrite 5 RLS policies to call `(select auth.uid())` instead of `auth.uid()`
--    directly. The bare call is treated as a volatile expression by the planner
--    and re-evaluates per row; wrapping in a SELECT hoists it to an InitPlan
--    that runs once per statement. Materially faster at scale with no semantic
--    change.
-- 2. Add covering indexes for two previously-unindexed FKs flagged by the
--    `unindexed_foreign_keys` advisor.
--
-- See https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

-- ============================================================================
-- Re-create announcements policies
-- ============================================================================
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
  for select to authenticated
  using (
    public.is_platform_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_access('admin_control_center', 'admin')
        or author_user_id = (select auth.uid())
        or (
          public.has_module_access('communications', 'read')
          and (
            target_audience = 'all_staff'
            or target_role_ids && (
              select coalesce(array_agg(role_id), array[]::uuid[])
              from public.user_roles where user_id = (select auth.uid())
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
      and author_user_id = (select auth.uid())
    )
  );

drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements
  for update to authenticated
  using (
    public.is_platform_admin()
    or (
      author_user_id = (select auth.uid())
      and not exists (
        select 1 from public.announcement_reads
        where announcement_id = announcements.id
      )
    )
  )
  with check (
    public.is_platform_admin()
    or author_user_id = (select auth.uid())
  );

-- ============================================================================
-- Re-create announcement_reads policies
-- ============================================================================
drop policy if exists announcement_reads_select on public.announcement_reads;
create policy announcement_reads_select on public.announcement_reads
  for select to authenticated
  using (
    public.is_platform_admin()
    or user_id = (select auth.uid())
    or exists (
      select 1 from public.announcements a
      where a.id = announcement_reads.announcement_id
        and (
          a.author_user_id = (select auth.uid())
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
  with check (user_id = (select auth.uid()));

drop policy if exists announcement_reads_update on public.announcement_reads;
create policy announcement_reads_update on public.announcement_reads
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ============================================================================
-- Covering indexes for previously-unindexed FKs
-- ============================================================================

-- announcements.archived_by — admin audit lookups ("what did X archive?")
create index if not exists announcements_archived_by_idx
  on public.announcements (archived_by)
  where archived_by is not null;

-- announcements.author_user_id — existing announcements_facility_author_idx
-- covers (facility_id, author_user_id, posted_at desc) which satisfies the FK
-- but the advisor doesn't detect composite index coverage; a dedicated FK
-- index resolves the flag without cost (small table, low write volume).
create index if not exists announcements_author_user_id_idx
  on public.announcements (author_user_id);
