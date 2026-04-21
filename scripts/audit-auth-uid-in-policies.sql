-- scripts/audit-auth-uid-in-policies.sql
--
-- Diagnostic scan: lists every RLS policy in `public` that still calls
-- `auth.uid()` bare (i.e. outside a `(select auth.uid())` wrapper). Bare
-- calls re-evaluate per row; wrapped calls become an InitPlan that runs
-- once per statement. The `auth_rls_initplan` Supabase advisor flags the
-- bare form as WARN.
--
-- This file is a READ-ONLY diagnostic. The enforcement gate lives in
-- `supabase/tests/23_no_bare_auth_uid_in_policies.test.sql` — run by pgTAP
-- on every PR. When that test fails, paste this query into the Supabase
-- SQL editor (or `supabase db execute --file ...`) to see which policies
-- need rewriting.
--
-- Detection caveat: Postgres canonicalizes `(select auth.uid())` as
-- `( SELECT auth.uid() AS uid)`. This scan counts total `auth.uid()`
-- occurrences and subtracts wrapped occurrences (the canonical form with
-- the `AS uid` alias). Exotic forms (`auth.uid()::text`, etc.) would need
-- an updated regex.

with policy_counts as (
  select
    schemaname, tablename, policyname, cmd, qual, with_check,
    coalesce(array_length(regexp_split_to_array(coalesce(qual, ''),       'auth\.uid\(\)'), 1), 1) - 1 as qual_total,
    coalesce(array_length(regexp_split_to_array(coalesce(qual, ''),       'SELECT auth\.uid\(\) AS uid'), 1), 1) - 1 as qual_wrapped,
    coalesce(array_length(regexp_split_to_array(coalesce(with_check, ''), 'auth\.uid\(\)'), 1), 1) - 1 as wc_total,
    coalesce(array_length(regexp_split_to_array(coalesce(with_check, ''), 'SELECT auth\.uid\(\) AS uid'), 1), 1) - 1 as wc_wrapped
  from pg_policies
  where schemaname = 'public'
)
select
  tablename,
  policyname,
  cmd,
  (qual_total - qual_wrapped)       as qual_bare_count,
  (wc_total - wc_wrapped)           as with_check_bare_count,
  qual,
  with_check
from policy_counts
where (qual_total - qual_wrapped) > 0
   or (wc_total - wc_wrapped) > 0
order by tablename, policyname;
