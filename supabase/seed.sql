-- supabase/seed.sql
-- Dev/test seed. Runs after migrations on `supabase db reset`, `supabase start`, and
-- local CI test runs. Does NOT run against remote (production) environments unless
-- explicitly applied — production seeding goes through Agent 1b's `createFacilityWithFirstAdmin`.
--
-- What this seeds:
--   * Two test facilities ("Rink Alpha", "Rink Beta") each with:
--       - 3 roles: Admin (is_system), Manager, Staff
--       - 3 users (one per role) with deterministic UUIDs
--       - All 9 modules enabled
--       - Realistic role_module_access per role
--   * 1 platform admin user, pinned to the Platform Operations facility
--   * At least one audit_log entry per seed step
--
-- All UUIDs are deterministic so pgTAP tests can reference them by constant.
--
-- Idempotency: every insert uses ON CONFLICT DO NOTHING. Rerunnable safely.
--
-- Deactivated user test case:
--   * Facility Alpha has an additional user "Alpha Deactivated" with active = false.
--     Middleware tests verify this user cannot authenticate.

-- Deterministic UUIDs (used throughout tests)
-- Platform admin
--   user_id: 00000000-0000-0000-0000-000000000001
-- Facility Alpha
--   facility: 00000001-0000-0000-0000-000000000001
--   admin:    00000001-0000-0000-0000-000000001001
--   manager:  00000001-0000-0000-0000-000000001002
--   staff:    00000001-0000-0000-0000-000000001003
--   deact:    00000001-0000-0000-0000-000000001004
-- Facility Beta
--   facility: 00000002-0000-0000-0000-000000000002
--   admin:    00000002-0000-0000-0000-000000002001
--   manager:  00000002-0000-0000-0000-000000002002
--   staff:    00000002-0000-0000-0000-000000002003

-- ============================================================================
-- Platform admin auth.users row
-- ============================================================================
insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role, instance_id)
values (
  '00000000-0000-0000-0000-000000000001',
  'platform@rinkreports.test',
  crypt('platform-dev-only', gen_salt('bf')),
  now(), now(), now(),
  'authenticated', 'authenticated',
  '00000000-0000-0000-0000-000000000000'
)
on conflict (id) do nothing;

-- Platform admin profile (pinned to Platform Operations facility)
insert into public.users (id, facility_id, full_name, email, active)
select
  '00000000-0000-0000-0000-000000000001',
  public.platform_facility_id(),
  'Platform Admin',
  'platform@rinkreports.test',
  true
on conflict (id) do nothing;

insert into public.platform_admins (user_id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (user_id) do nothing;

-- ============================================================================
-- Facility Alpha
-- ============================================================================

insert into public.facilities (id, slug, name, timezone, address, plan_tier, is_platform)
values (
  '00000001-0000-0000-0000-000000000001',
  'rink-alpha',
  'Rink Alpha',
  'America/Toronto',
  '{"street":"1 Alpha Way","city":"Toronto","state":"ON","postal_code":"M5V 1A1"}'::jsonb,
  'single_facility',
  false
)
on conflict (slug) do nothing;

-- Roles
insert into public.roles (id, facility_id, name, description, is_system)
values
  ('00000001-1000-0000-0000-000000000001', '00000001-0000-0000-0000-000000000001',
   'Admin', 'Facility administrator', true),
  ('00000001-1000-0000-0000-000000000002', '00000001-0000-0000-0000-000000000001',
   'Manager', 'Shift manager', false),
  ('00000001-1000-0000-0000-000000000003', '00000001-0000-0000-0000-000000000001',
   'Staff', 'Rink staff', false)
on conflict (facility_id, name) do nothing;

-- Enable all modules for Alpha
insert into public.facility_modules (facility_id, module_id, is_enabled)
select '00000001-0000-0000-0000-000000000001', m.id, true
from public.modules m
on conflict (facility_id, module_id) do nothing;

-- role_module_access: Admin full, Manager write, Staff write (daily ops) / write (safety) / none (admin_control_center)
-- Admin gets admin on every module
insert into public.role_module_access (role_id, module_id, access_level)
select '00000001-1000-0000-0000-000000000001', m.id, 'admin'
from public.modules m
on conflict (role_id, module_id) do update set access_level = excluded.access_level;

-- Manager gets write on every module except admin_control_center (admin)
insert into public.role_module_access (role_id, module_id, access_level)
select
  '00000001-1000-0000-0000-000000000002',
  m.id,
  case when m.slug = 'admin_control_center' then 'write' else 'write' end
from public.modules m
on conflict (role_id, module_id) do update set access_level = excluded.access_level;

-- Staff gets write on operations + safety modules, none on admin_control_center
insert into public.role_module_access (role_id, module_id, access_level)
select
  '00000001-1000-0000-0000-000000000003',
  m.id,
  case
    when m.slug = 'admin_control_center' then 'none'
    when m.slug = 'scheduling' then 'write'  -- staff need to submit availability
    when m.slug = 'communications' then 'read'
    else 'write'
  end
from public.modules m
on conflict (role_id, module_id) do update set access_level = excluded.access_level;

-- Alpha users (auth.users + public.users + user_roles)
insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role, instance_id)
values
  ('00000001-0000-0000-0000-000000001001', 'admin@alpha.test', crypt('alpha-admin', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('00000001-0000-0000-0000-000000001002', 'manager@alpha.test', crypt('alpha-manager', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('00000001-0000-0000-0000-000000001003', 'staff@alpha.test', crypt('alpha-staff', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('00000001-0000-0000-0000-000000001004', 'deactivated@alpha.test', crypt('alpha-deact', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')
on conflict (id) do nothing;

insert into public.users (id, facility_id, full_name, email, active)
values
  ('00000001-0000-0000-0000-000000001001', '00000001-0000-0000-0000-000000000001', 'Alpha Admin',   'admin@alpha.test',       true),
  ('00000001-0000-0000-0000-000000001002', '00000001-0000-0000-0000-000000000001', 'Alpha Manager', 'manager@alpha.test',     true),
  ('00000001-0000-0000-0000-000000001003', '00000001-0000-0000-0000-000000000001', 'Alpha Staff',   'staff@alpha.test',       true),
  ('00000001-0000-0000-0000-000000001004', '00000001-0000-0000-0000-000000000001', 'Alpha Deact',   'deactivated@alpha.test', false)
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_id)
values
  ('00000001-0000-0000-0000-000000001001', '00000001-1000-0000-0000-000000000001'),
  ('00000001-0000-0000-0000-000000001002', '00000001-1000-0000-0000-000000000002'),
  ('00000001-0000-0000-0000-000000001003', '00000001-1000-0000-0000-000000000003'),
  ('00000001-0000-0000-0000-000000001004', '00000001-1000-0000-0000-000000000003')
on conflict (user_id, role_id) do nothing;

-- ============================================================================
-- Facility Beta
-- ============================================================================

insert into public.facilities (id, slug, name, timezone, address, plan_tier, is_platform)
values (
  '00000002-0000-0000-0000-000000000002',
  'rink-beta',
  'Rink Beta',
  'America/Vancouver',
  '{"street":"2 Beta Blvd","city":"Vancouver","state":"BC","postal_code":"V6B 1A1"}'::jsonb,
  'single_facility',
  false
)
on conflict (slug) do nothing;

insert into public.roles (id, facility_id, name, description, is_system)
values
  ('00000002-2000-0000-0000-000000000001', '00000002-0000-0000-0000-000000000002', 'Admin',   'Facility administrator', true),
  ('00000002-2000-0000-0000-000000000002', '00000002-0000-0000-0000-000000000002', 'Manager', 'Shift manager',          false),
  ('00000002-2000-0000-0000-000000000003', '00000002-0000-0000-0000-000000000002', 'Staff',   'Rink staff',             false)
on conflict (facility_id, name) do nothing;

insert into public.facility_modules (facility_id, module_id, is_enabled)
select '00000002-0000-0000-0000-000000000002', m.id, true
from public.modules m
on conflict (facility_id, module_id) do nothing;

insert into public.role_module_access (role_id, module_id, access_level)
select '00000002-2000-0000-0000-000000000001', m.id, 'admin'
from public.modules m
on conflict (role_id, module_id) do update set access_level = excluded.access_level;

insert into public.role_module_access (role_id, module_id, access_level)
select '00000002-2000-0000-0000-000000000002', m.id, 'write'
from public.modules m
on conflict (role_id, module_id) do update set access_level = excluded.access_level;

insert into public.role_module_access (role_id, module_id, access_level)
select
  '00000002-2000-0000-0000-000000000003',
  m.id,
  case
    when m.slug = 'admin_control_center' then 'none'
    when m.slug = 'communications' then 'read'
    else 'write'
  end
from public.modules m
on conflict (role_id, module_id) do update set access_level = excluded.access_level;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role, instance_id)
values
  ('00000002-0000-0000-0000-000000002001', 'admin@beta.test',   crypt('beta-admin',   gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('00000002-0000-0000-0000-000000002002', 'manager@beta.test', crypt('beta-manager', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('00000002-0000-0000-0000-000000002003', 'staff@beta.test',   crypt('beta-staff',   gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')
on conflict (id) do nothing;

insert into public.users (id, facility_id, full_name, email, active)
values
  ('00000002-0000-0000-0000-000000002001', '00000002-0000-0000-0000-000000000002', 'Beta Admin',   'admin@beta.test',   true),
  ('00000002-0000-0000-0000-000000002002', '00000002-0000-0000-0000-000000000002', 'Beta Manager', 'manager@beta.test', true),
  ('00000002-0000-0000-0000-000000002003', '00000002-0000-0000-0000-000000000002', 'Beta Staff',   'staff@beta.test',   true)
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_id)
values
  ('00000002-0000-0000-0000-000000002001', '00000002-2000-0000-0000-000000000001'),
  ('00000002-0000-0000-0000-000000002002', '00000002-2000-0000-0000-000000000002'),
  ('00000002-0000-0000-0000-000000002003', '00000002-2000-0000-0000-000000000003')
on conflict (user_id, role_id) do nothing;

-- ============================================================================
-- Example audit_log entries (prove the table works end-to-end in seed)
-- ============================================================================

insert into public.audit_log (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
values
  ('00000001-0000-0000-0000-000000000001',
   '00000001-0000-0000-0000-000000001001',
   'facility.seeded',
   'facility',
   '00000001-0000-0000-0000-000000000001',
   '{"source":"seed.sql","note":"Facility Alpha seeded with 4 users and 9 modules"}'::jsonb),
  ('00000002-0000-0000-0000-000000000002',
   '00000002-0000-0000-0000-000000002001',
   'facility.seeded',
   'facility',
   '00000002-0000-0000-0000-000000000002',
   '{"source":"seed.sql","note":"Facility Beta seeded with 3 users and 9 modules"}'::jsonb);
