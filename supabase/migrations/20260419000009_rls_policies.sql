-- 20260419000009_rls_policies.sql
-- Row-level security policies for every tenant-scoped table.
--
-- Policy pattern:
--   * SELECT: facility_id = current_facility_id() OR is_platform_admin()
--   * INSERT: same AND (for admin-write tables) has_module_access(...)
--              facility_id is forced via column DEFAULT (current_facility_id()) where
--              applicable, never accepted from client.
--   * UPDATE/DELETE: same AND (for admin-write tables) has_module_access(..., 'admin')
--
-- RLS is already enabled on every table. This migration adds the policies.

----------------------------------------------------------------------------
-- facilities
----------------------------------------------------------------------------

-- Anyone authenticated in this facility can see their own facility row.
-- Platform admins see every row.
drop policy if exists facilities_select on public.facilities;
create policy facilities_select on public.facilities
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or id = public.current_facility_id()
  );

-- Only platform admins create facilities (via Agent 1b's createFacilityWithFirstAdmin).
drop policy if exists facilities_insert on public.facilities;
create policy facilities_insert on public.facilities
  for insert
  to authenticated
  with check (public.is_platform_admin());

-- Facility admins edit their own facility row (name, timezone, address, settings).
-- Platform admins edit any.
drop policy if exists facilities_update on public.facilities;
create policy facilities_update on public.facilities
  for update
  to authenticated
  using (
    public.is_platform_admin()
    or (id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  )
  with check (
    public.is_platform_admin()
    or (id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  );

-- Only platform admins delete. Day-to-day "archive" is not modeled in v1.
drop policy if exists facilities_delete on public.facilities;
create policy facilities_delete on public.facilities
  for delete
  to authenticated
  using (public.is_platform_admin());

----------------------------------------------------------------------------
-- users
----------------------------------------------------------------------------

-- Everyone in the facility can see other users in the facility (for mentions,
-- assignment pickers, etc.). Platform admins see all.
drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or facility_id = public.current_facility_id()
  );

-- INSERT via service role only (Agent 1b's accept-invite flow uses the service role
-- to create the auth.users row and the public.users profile atomically).
drop policy if exists users_insert on public.users;
create policy users_insert on public.users
  for insert
  to authenticated
  with check (public.is_platform_admin());

-- UPDATE: platform admin for anyone. Facility admin for users in own facility.
-- Self-edit of full_name only is handled by a dedicated server action that uses
-- the service role; not covered here.
-- Note: facility_id changes are blocked by the users_prevent_facility_change trigger.
drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update
  to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  )
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  );

-- DELETE: platform admin only. Deactivation via active=false is the normal path.
drop policy if exists users_delete on public.users;
create policy users_delete on public.users
  for delete
  to authenticated
  using (public.is_platform_admin());

----------------------------------------------------------------------------
-- roles
----------------------------------------------------------------------------

drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert
  to authenticated
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  );

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
  for update
  to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  )
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  );

drop policy if exists roles_delete on public.roles;
create policy roles_delete on public.roles
  for delete
  to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  );

----------------------------------------------------------------------------
-- user_roles
----------------------------------------------------------------------------

-- Visible if the user being joined-to is in your facility.
drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.users u
      where u.id = user_roles.user_id
        and u.facility_id = public.current_facility_id()
    )
  );

drop policy if exists user_roles_insert on public.user_roles;
create policy user_roles_insert on public.user_roles
  for insert
  to authenticated
  with check (
    public.is_platform_admin()
    or (
      public.has_module_access('admin_control_center', 'admin')
      and exists (
        select 1 from public.users u
        where u.id = user_roles.user_id
          and u.facility_id = public.current_facility_id()
      )
      and exists (
        select 1 from public.roles r
        where r.id = user_roles.role_id
          and r.facility_id = public.current_facility_id()
      )
    )
  );

drop policy if exists user_roles_update on public.user_roles;
create policy user_roles_update on public.user_roles
  for update
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.has_module_access('admin_control_center', 'admin')
      and exists (
        select 1 from public.users u
        where u.id = user_roles.user_id
          and u.facility_id = public.current_facility_id()
      )
    )
  );

drop policy if exists user_roles_delete on public.user_roles;
create policy user_roles_delete on public.user_roles
  for delete
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.has_module_access('admin_control_center', 'admin')
      and exists (
        select 1 from public.users u
        where u.id = user_roles.user_id
          and u.facility_id = public.current_facility_id()
      )
    )
  );

----------------------------------------------------------------------------
-- modules (global)
----------------------------------------------------------------------------

-- Read-only for all authenticated users; only platform admins manage the catalog.
drop policy if exists modules_select on public.modules;
create policy modules_select on public.modules
  for select
  to authenticated
  using (true);

drop policy if exists modules_insert on public.modules;
create policy modules_insert on public.modules
  for insert
  to authenticated
  with check (public.is_platform_admin());

drop policy if exists modules_update on public.modules;
create policy modules_update on public.modules
  for update
  to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists modules_delete on public.modules;
create policy modules_delete on public.modules
  for delete
  to authenticated
  using (public.is_platform_admin());

----------------------------------------------------------------------------
-- facility_modules
----------------------------------------------------------------------------

drop policy if exists facility_modules_select on public.facility_modules;
create policy facility_modules_select on public.facility_modules
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists facility_modules_insert on public.facility_modules;
create policy facility_modules_insert on public.facility_modules
  for insert
  to authenticated
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  );

drop policy if exists facility_modules_update on public.facility_modules;
create policy facility_modules_update on public.facility_modules
  for update
  to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  )
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  );

drop policy if exists facility_modules_delete on public.facility_modules;
create policy facility_modules_delete on public.facility_modules
  for delete
  to authenticated
  using (public.is_platform_admin());

----------------------------------------------------------------------------
-- role_module_access
----------------------------------------------------------------------------

drop policy if exists role_module_access_select on public.role_module_access;
create policy role_module_access_select on public.role_module_access
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.roles r
      where r.id = role_module_access.role_id
        and r.facility_id = public.current_facility_id()
    )
  );

drop policy if exists role_module_access_insert on public.role_module_access;
create policy role_module_access_insert on public.role_module_access
  for insert
  to authenticated
  with check (
    public.is_platform_admin()
    or (
      public.has_module_access('admin_control_center', 'admin')
      and exists (
        select 1 from public.roles r
        where r.id = role_module_access.role_id
          and r.facility_id = public.current_facility_id()
      )
    )
  );

drop policy if exists role_module_access_update on public.role_module_access;
create policy role_module_access_update on public.role_module_access
  for update
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.has_module_access('admin_control_center', 'admin')
      and exists (
        select 1 from public.roles r
        where r.id = role_module_access.role_id
          and r.facility_id = public.current_facility_id()
      )
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.has_module_access('admin_control_center', 'admin')
      and exists (
        select 1 from public.roles r
        where r.id = role_module_access.role_id
          and r.facility_id = public.current_facility_id()
      )
    )
  );

drop policy if exists role_module_access_delete on public.role_module_access;
create policy role_module_access_delete on public.role_module_access
  for delete
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.has_module_access('admin_control_center', 'admin')
      and exists (
        select 1 from public.roles r
        where r.id = role_module_access.role_id
          and r.facility_id = public.current_facility_id()
      )
    )
  );

----------------------------------------------------------------------------
-- platform_admins
----------------------------------------------------------------------------

-- Platform admin membership is visible only to platform admins. Application code
-- uses is_platform_admin() for checks; it does not read this table directly.
drop policy if exists platform_admins_select on public.platform_admins;
create policy platform_admins_select on public.platform_admins
  for select
  to authenticated
  using (public.is_platform_admin());

drop policy if exists platform_admins_insert on public.platform_admins;
create policy platform_admins_insert on public.platform_admins
  for insert
  to authenticated
  with check (public.is_platform_admin());

drop policy if exists platform_admins_update on public.platform_admins;
create policy platform_admins_update on public.platform_admins
  for update
  to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists platform_admins_delete on public.platform_admins;
create policy platform_admins_delete on public.platform_admins
  for delete
  to authenticated
  using (public.is_platform_admin());

----------------------------------------------------------------------------
-- audit_log
----------------------------------------------------------------------------

-- Facility users see audit events for their facility. Platform admins see all,
-- including null-facility platform events.
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or facility_id = public.current_facility_id()
  );

-- INSERT: any authenticated user may write audit rows for their own actions in their
-- own facility. Server actions should always set facility_id = current_facility_id()
-- and actor_user_id = auth.uid(); the policy enforces consistency.
drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert
  to authenticated
  with check (
    public.is_platform_admin()
    or (
      actor_user_id = auth.uid()
      and (facility_id is null or facility_id = public.current_facility_id())
    )
  );

-- UPDATE/DELETE are blocked by triggers in 20260419000007_audit_log.sql; no policies
-- would also work, but belt-and-suspenders is cheap here.
