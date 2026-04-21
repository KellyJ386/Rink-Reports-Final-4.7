-- supabase/tests/23_no_bare_auth_uid_in_policies.test.sql
--
-- Agent 9 — regression gate for the `auth.uid()` hoisting hygiene that
-- 20260427000002_auth_uid_initplan_hoisting.sql closed out.
--
-- This test counts the number of RLS policies in `public` that still call
-- `auth.uid()` bare (i.e. outside a `(select auth.uid())` wrapper). Zero is
-- the only acceptable value. If a future PR lands a new policy with a bare
-- `auth.uid()`, this test fails at pgTAP time before the policy merges.
--
-- Diagnostic when the assertion fails:
--   Paste `scripts/audit-auth-uid-in-policies.sql` into the Supabase SQL
--   editor. It prints the offending policies with their qual / with_check
--   text. Rewrite each bare `auth.uid()` to `(select auth.uid())` and
--   ship the rewrite in the same PR.

begin;
select plan(1);

with policy_counts as (
  select
    coalesce(array_length(regexp_split_to_array(coalesce(qual, ''),       'auth\.uid\(\)'), 1), 1) - 1 as qual_total,
    coalesce(array_length(regexp_split_to_array(coalesce(qual, ''),       'SELECT auth\.uid\(\) AS uid'), 1), 1) - 1 as qual_wrapped,
    coalesce(array_length(regexp_split_to_array(coalesce(with_check, ''), 'auth\.uid\(\)'), 1), 1) - 1 as wc_total,
    coalesce(array_length(regexp_split_to_array(coalesce(with_check, ''), 'SELECT auth\.uid\(\) AS uid'), 1), 1) - 1 as wc_wrapped
  from pg_policies
  where schemaname = 'public'
)
select is(
  (select count(*)::int
   from policy_counts
   where (qual_total - qual_wrapped) > 0 or (wc_total - wc_wrapped) > 0),
  0,
  'no RLS policies in public contain bare auth.uid() calls (see scripts/audit-auth-uid-in-policies.sql for diagnostic)'
);

select * from finish();
rollback;
