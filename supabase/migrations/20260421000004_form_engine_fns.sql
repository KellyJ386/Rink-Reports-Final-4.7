-- 20260421000004_form_engine_fns.sql
-- Form engine SQL RPCs: publish draft, discard draft, and the audit hook for module
-- enablement. Submission inserts happen via direct table INSERT from server actions
-- (the submission-table registry varies per module; a generic RPC would lose type
-- safety without buying much).

-- rpc_publish_form_schema(form_schema_id)
--   Caller has already validated draft_definition against the meta-schema in TS.
--   This RPC does the atomic DB work:
--     1. Lock the row.
--     2. Snapshot current (schema_definition, version) into form_schema_history.
--     3. Swap schema_definition ← draft_definition, null draft, version += 1.
--     4. Audit log.
--
-- AuthZ inside the function: platform admin OR admin_control_center admin in the
-- target facility.

create or replace function public.rpc_publish_form_schema(
  p_form_schema_id uuid
)
returns table (
  new_version int,
  published_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_new_version int;
  v_now timestamptz := now();
begin
  select id, facility_id, module_slug, form_type, schema_definition, draft_definition, version
  into v_row
  from public.form_schemas
  where id = p_form_schema_id
  for update;

  if v_row.id is null then
    raise exception 'form_schema % not found', p_form_schema_id using errcode = 'P0002';
  end if;

  -- AuthZ
  if not (
    public.is_platform_admin()
    or (
      v_row.facility_id = public.current_facility_id()
      and public.has_module_access('admin_control_center', 'admin')
    )
  ) then
    raise exception 'not authorized to publish form schema for this facility'
      using errcode = '42501';
  end if;

  if v_row.draft_definition is null then
    raise exception 'no draft to publish' using errcode = 'P0001';
  end if;

  -- 1. Snapshot current
  insert into public.form_schema_history
    (facility_id, module_slug, form_type, version, schema_definition, published_by, published_at)
  values
    (v_row.facility_id, v_row.module_slug, v_row.form_type, v_row.version,
     v_row.schema_definition, auth.uid(), v_now);

  v_new_version := v_row.version + 1;

  -- 2. Swap
  update public.form_schemas
  set schema_definition = draft_definition,
      draft_definition  = null,
      version           = v_new_version,
      updated_at        = v_now,
      updated_by        = auth.uid(),
      is_published      = true
  where id = p_form_schema_id;

  -- 3. Audit
  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_row.facility_id,
    auth.uid(),
    'form_schema.published',
    'form_schema',
    p_form_schema_id,
    jsonb_build_object(
      'module_slug', v_row.module_slug,
      'form_type', v_row.form_type,
      'new_version', v_new_version
    )
  );

  return query select v_new_version, v_now;
end;
$$;

grant execute on function public.rpc_publish_form_schema(uuid) to authenticated;

comment on function public.rpc_publish_form_schema(uuid) is
  'Atomically snapshot + swap draft → schema_definition + version++ + audit. Caller must have validated draft against the meta-schema in TS first.';

-- rpc_discard_form_schema_draft(form_schema_id)
--   Null out the draft. Idempotent (safe on a row with no draft).

create or replace function public.rpc_discard_form_schema_draft(
  p_form_schema_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select id, facility_id, draft_definition
  into v_row
  from public.form_schemas
  where id = p_form_schema_id
  for update;

  if v_row.id is null then
    raise exception 'form_schema % not found', p_form_schema_id using errcode = 'P0002';
  end if;

  if not (
    public.is_platform_admin()
    or (
      v_row.facility_id = public.current_facility_id()
      and public.has_module_access('admin_control_center', 'admin')
    )
  ) then
    raise exception 'not authorized to discard draft for this facility'
      using errcode = '42501';
  end if;

  if v_row.draft_definition is null then
    return;  -- idempotent
  end if;

  update public.form_schemas
  set draft_definition = null,
      updated_at       = now(),
      updated_by       = auth.uid()
  where id = p_form_schema_id;

  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_row.facility_id,
    auth.uid(),
    'form_schema.draft_discarded',
    'form_schema',
    p_form_schema_id,
    '{}'::jsonb
  );
end;
$$;

grant execute on function public.rpc_discard_form_schema_draft(uuid) to authenticated;

comment on function public.rpc_discard_form_schema_draft(uuid) is
  'Null out draft_definition. Idempotent. Writes audit_log. Caller must be facility admin or platform admin.';

-- rpc_save_form_schema_draft(form_schema_id, draft_definition)
--   Write a new draft. Validation happens in TS before calling. Multiple saves just
--   overwrite. Does not bump version; version only bumps on publish.

create or replace function public.rpc_save_form_schema_draft(
  p_form_schema_id uuid,
  p_draft_definition jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select id, facility_id
  into v_row
  from public.form_schemas
  where id = p_form_schema_id
  for update;

  if v_row.id is null then
    raise exception 'form_schema % not found', p_form_schema_id using errcode = 'P0002';
  end if;

  if not (
    public.is_platform_admin()
    or (
      v_row.facility_id = public.current_facility_id()
      and public.has_module_access('admin_control_center', 'admin')
    )
  ) then
    raise exception 'not authorized to edit form schema for this facility'
      using errcode = '42501';
  end if;

  update public.form_schemas
  set draft_definition = p_draft_definition,
      updated_at       = now(),
      updated_by       = auth.uid()
  where id = p_form_schema_id;
end;
$$;

grant execute on function public.rpc_save_form_schema_draft(uuid, jsonb) to authenticated;

comment on function public.rpc_save_form_schema_draft(uuid, jsonb) is
  'Write or overwrite draft_definition. Validation happens in the TS layer before this RPC. Does not bump version.';
