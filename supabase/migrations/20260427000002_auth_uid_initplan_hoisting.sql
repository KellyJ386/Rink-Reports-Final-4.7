-- 20260427000002_auth_uid_initplan_hoisting.sql
--
-- Agent 9 hardening — cross-cutting fix for the `auth_rls_initplan` performance
-- advisor warnings: 3 RLS policies on 2 tables still call `auth.uid()` directly
-- in qual / with_check, causing per-row re-evaluation. Wrapping each call in
-- `(select auth.uid())` hoists the call to an InitPlan that runs once per
-- statement instead of once per row.
--
-- Same semantic as the Agent 8 PR c13ac12 fix for announcements +
-- announcement_reads; extending the pattern across the remaining flagged
-- policies.
--
-- Audit methodology: `scripts/audit-auth-uid-in-policies.mjs` scans
-- pg_policies for bare `auth.uid()` occurrences (excluding already-wrapped
-- canonical form `SELECT auth.uid() AS uid`). After this migration, the scan
-- returns 0 results.
--
-- No behavior change. `auth.uid()` returns the same value whether called per-
-- row or once; the hoist only affects planner cost.

-- ============================================================================
-- audit_log.audit_log_insert — with_check
-- ============================================================================
drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert
  to authenticated
  with check (
    public.is_platform_admin()
    or (
      actor_user_id = (select auth.uid())
      and (facility_id is null or facility_id = public.current_facility_id())
    )
  );

-- ============================================================================
-- notifications.notifications_select — qual
-- ============================================================================
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_platform_admin()
  );

-- ============================================================================
-- notifications.notifications_update — qual + with_check
-- ============================================================================
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
