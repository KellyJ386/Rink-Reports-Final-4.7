-- 20260427000001_billing_events_rls_fix.sql
--
-- The original billing_events migration left INSERT and UPDATE restricted to
-- service role only (no policy for authenticated users).  The pgTAP test
-- (17_agent_7.test.sql) expects that platform admins can INSERT rows and that
-- UPDATE of immutable columns (stripe_event_id, event_type, payload) raises an
-- exception (thrown by the existing tg_billing_events_update_guard trigger).
--
-- Without an RLS UPDATE policy, the BEFORE UPDATE trigger never fires for
-- authenticated users — the row simply matches zero RLS-visible rows and the
-- UPDATE silently does nothing instead of throwing.
--
-- Changes:
--   1. INSERT policy for platform admins (allows webhook-proxied inserts in
--      platform-admin context during tests / admin tooling).
--   2. UPDATE policy for platform admins (so tg_billing_events_update_guard
--      fires and blocks changes to immutable columns while still allowing
--      processed_at / error_if_any updates).

drop policy if exists billing_events_insert on public.billing_events;
create policy billing_events_insert on public.billing_events
  for insert to authenticated
  with check (public.is_platform_admin());

drop policy if exists billing_events_update on public.billing_events;
create policy billing_events_update on public.billing_events
  for update to authenticated
  using  (public.is_platform_admin())
  with check (public.is_platform_admin());
