-- 20260419000006_platform_admins.sql
-- Users with cross-facility superpowers. Escape hatch in every RLS policy.
--
-- Design notes:
--   * Platform admins still have a real users row with facility_id pointing at the
--     Platform Operations facility (see 20260419000010_seed_platform_ops.sql).
--   * A user is a platform admin iff their user_id appears here.
--   * Every tenant-scoped RLS policy ORs in is_platform_admin().

create table if not exists public.platform_admins (
  user_id         uuid primary key references public.users(id) on delete cascade,
  created_at      timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

comment on table public.platform_admins is
  'Users with cross-facility access. See is_platform_admin() in helper functions migration.';
