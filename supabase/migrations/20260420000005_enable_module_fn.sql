-- 20260420000005_enable_module_fn.sql
-- The rpc_enable_module() function. Flips facility_modules.is_enabled = true and seeds
-- per-facility form_schemas rows from module_default_schemas.
--
-- form_schemas is owned by Agent 2 (not yet shipped in Phase 1). To stay forward-safe,
-- the form_schemas insert uses dynamic SQL via EXECUTE, guarded by a check against
-- information_schema.tables. In Phase 1, the guard is false and the insert is a no-op.
-- When Agent 2 ships form_schemas, the guard flips true and enableModule begins seeding
-- without any change to this function.

create or replace function public.rpc_enable_module(
  p_facility_id uuid,
  p_module_slug text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_module_id uuid;
  v_form_schemas_exists bool;
begin
  -- AuthZ: platform admin OR facility admin for this facility
  if not (
    public.is_platform_admin()
    or (
      p_facility_id = public.current_facility_id()
      and public.has_module_access('admin_control_center', 'admin')
    )
  ) then
    raise exception 'rpc_enable_module: not authorized for facility %', p_facility_id
      using errcode = '42501';
  end if;

  -- Resolve module_id
  select id into v_module_id from public.modules where slug = p_module_slug;
  if v_module_id is null then
    raise exception 'rpc_enable_module: unknown module slug "%"', p_module_slug
      using errcode = '22023';
  end if;

  -- 1. Flip facility_modules.is_enabled = true (upsert)
  insert into public.facility_modules (facility_id, module_id, is_enabled, enabled_at)
  values (p_facility_id, v_module_id, true, now())
  on conflict (facility_id, module_id) do update
    set is_enabled = true, enabled_at = now();

  -- 2. Seed form_schemas from module_default_schemas IF form_schemas exists (Agent 2+).
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'form_schemas'
  ) into v_form_schemas_exists;

  if v_form_schemas_exists then
    execute format($sql$
      insert into public.form_schemas
        (facility_id, module_slug, form_type, schema_definition, version, is_published)
      select
        %L::uuid, mds.module_slug, mds.form_type, mds.default_schema_definition, 1, true
      from public.module_default_schemas mds
      where mds.module_slug = %L
      on conflict do nothing
    $sql$, p_facility_id, p_module_slug);
  end if;

  -- 3. Audit
  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, metadata)
  values (
    p_facility_id,
    auth.uid(),
    'module.enabled',
    'module',
    jsonb_build_object(
      'module_slug', p_module_slug,
      'seeded_defaults', v_form_schemas_exists
    )
  );
end;
$$;

grant execute on function public.rpc_enable_module(uuid, text) to authenticated;

comment on function public.rpc_enable_module(uuid, text) is
  'Enable a module for a facility. Flips facility_modules.is_enabled=true; seeds per-facility form_schemas from module_default_schemas if Agent 2 has shipped form_schemas.';
