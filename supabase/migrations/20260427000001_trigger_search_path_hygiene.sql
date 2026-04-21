-- 20260427000001_trigger_search_path_hygiene.sql
-- Agent 9 hardening — cross-cutting fix for the 15 trigger functions flagged
-- by Supabase's `function_search_path_mutable` security advisor.
--
-- All 15 are `tg_*` trigger functions that run on BEFORE/AFTER row events.
-- Adding `SET search_path = public, pg_temp` makes the function's schema
-- lookup deterministic instead of deferring to the session's mutable
-- search_path — an advisory best practice Supabase enforces as a WARN lint.
--
-- Behavior is unchanged: every referenced table / function already lives in
-- `public` schema, so the existing body resolves identically before and
-- after this migration. The only difference is that the function's
-- `pg_proc.proconfig` now records the search_path explicitly, so future
-- calls can't be fooled by a session that has `search_path` set to
-- something else (e.g. an attacker's schema).
--
-- Agent 8's earlier fix for `tg_scheduled_job_runs_immutable_fields`
-- (commit c13ac12) used the same pattern for a single function shipped in
-- the same PR as the initial advisor run. This migration closes the gap
-- for the 15 pre-existing functions that were never retrofitted.
--
-- Tracked in KNOWN_GAPS.md hard-blockers until this migration lands.

alter function public.tg_roles_protect_system()               set search_path = public, pg_temp;
alter function public.tg_touch_updated_at()                   set search_path = public, pg_temp;
alter function public.tg_users_prevent_facility_change()      set search_path = public, pg_temp;
alter function public.tg_user_roles_facility_match()          set search_path = public, pg_temp;
alter function public.tg_audit_log_append_only()              set search_path = public, pg_temp;
alter function public.tg_invites_role_facility_match()        set search_path = public, pg_temp;
alter function public.tg_option_list_items_key_immutable()    set search_path = public, pg_temp;
alter function public.tg_form_schema_history_append_only()    set search_path = public, pg_temp;
alter function public.tg_ice_depth_templates_surface_check()  set search_path = public, pg_temp;
alter function public.tg_ice_depth_template_history_append_only() set search_path = public, pg_temp;
alter function public.tg_notifications_only_read_at()         set search_path = public, pg_temp;
alter function public.tg_billing_events_update_guard()        set search_path = public, pg_temp;
alter function public.tg_billing_events_no_delete()           set search_path = public, pg_temp;
alter function public.tg_impersonation_sessions_no_delete()   set search_path = public, pg_temp;
alter function public.tg_audit_log_populate_impersonator()    set search_path = public, pg_temp;
