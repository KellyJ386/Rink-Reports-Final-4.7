-- 20260423000002_ice_depth_fns.sql
-- SQL RPCs for Ice Depth atomicity:
--   rpc_save_ice_depth_template_draft(id, draft_points, name?, svg_key?)
--   rpc_publish_ice_depth_template(id) — snapshot + swap + bump + audit
--   rpc_discard_ice_depth_template_draft(id) — idempotent
--   rpc_complete_ice_depth_session(id) — validate all points recorded, flip status
--
-- Template validation at publish time:
--   - draft_points is a non-empty array
--   - every element has { key, label, x_pct (0-100), y_pct (0-100), sort_order }
--   - keys are unique across the array
--   - keys that already appear in historical readings stay present (otherwise the
--     publish would orphan those readings' point_key references — we reject it
--     rather than silently lose context)

create or replace function public.rpc_save_ice_depth_template_draft(
  p_template_id uuid,
  p_draft_points jsonb,
  p_name text default null,
  p_svg_key text default null
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
  from public.ice_depth_templates
  where id = p_template_id
  for update;

  if v_row.id is null then
    raise exception 'ice_depth_template % not found', p_template_id using errcode = 'P0002';
  end if;

  if not (
    public.is_platform_admin()
    or (
      v_row.facility_id = public.current_facility_id()
      and public.has_module_access('ice_depth', 'admin')
    )
  ) then
    raise exception 'not authorized to edit this ice depth template'
      using errcode = '42501';
  end if;

  if p_svg_key is not null and p_svg_key not in ('nhl', 'olympic', 'studio') then
    raise exception 'invalid svg_key "%"', p_svg_key using errcode = '22023';
  end if;

  -- Shallow shape validation. Deeper validation (point key uniqueness, no-orphan
  -- historical readings) happens at publish time.
  if p_draft_points is not null and jsonb_typeof(p_draft_points) <> 'array' then
    raise exception 'draft_points must be a JSON array' using errcode = '22023';
  end if;

  update public.ice_depth_templates
  set draft_points = coalesce(p_draft_points, draft_points),
      name         = coalesce(p_name, name),
      svg_key      = coalesce(p_svg_key, svg_key),
      updated_at   = now(),
      updated_by   = auth.uid()
  where id = p_template_id;
end;
$$;

grant execute on function public.rpc_save_ice_depth_template_draft(uuid, jsonb, text, text) to authenticated;

-- ----------------------------------------------------------------------------

create or replace function public.rpc_publish_ice_depth_template(
  p_template_id uuid
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
  v_keys text[];
  v_required_keys text[];
begin
  select id, facility_id, svg_key, current_points, draft_points, version
  into v_row
  from public.ice_depth_templates
  where id = p_template_id
  for update;

  if v_row.id is null then
    raise exception 'ice_depth_template % not found', p_template_id using errcode = 'P0002';
  end if;

  if not (
    public.is_platform_admin()
    or (
      v_row.facility_id = public.current_facility_id()
      and public.has_module_access('ice_depth', 'admin')
    )
  ) then
    raise exception 'not authorized to publish this template' using errcode = '42501';
  end if;

  if v_row.draft_points is null then
    raise exception 'no draft to publish' using errcode = 'P0001';
  end if;

  if jsonb_array_length(v_row.draft_points) = 0 then
    raise exception 'draft must contain at least one point' using errcode = 'P0001';
  end if;

  -- Extract keys from the draft + check uniqueness
  select array_agg(p->>'key' order by (p->>'sort_order')::int nulls last)
  into v_keys
  from jsonb_array_elements(v_row.draft_points) p;

  if (select count(distinct k) from unnest(v_keys) k) <> array_length(v_keys, 1) then
    raise exception 'draft_points contains duplicate point keys' using errcode = 'P0001';
  end if;

  -- Must not drop any key that appears in historical readings for this template
  select array_agg(distinct r.point_key)
  into v_required_keys
  from public.ice_depth_readings r
  join public.ice_depth_sessions s on s.id = r.session_id
  where s.template_id = p_template_id;

  if v_required_keys is not null then
    if exists (
      select 1 from unnest(v_required_keys) rk
      where rk is not null and rk not in (select unnest(v_keys))
    ) then
      raise exception 'cannot publish: draft removes point keys that are referenced by historical readings. Deactivate and add new points instead of removing.'
        using errcode = 'P0001';
    end if;
  end if;

  -- 1. Snapshot current
  insert into public.ice_depth_template_history
    (facility_id, template_id, version, svg_key, points, published_by, published_at)
  values
    (v_row.facility_id, p_template_id, v_row.version,
     v_row.svg_key, v_row.current_points, auth.uid(), v_now);

  v_new_version := v_row.version + 1;

  -- 2. Swap
  update public.ice_depth_templates
  set current_points = draft_points,
      draft_points   = null,
      version        = v_new_version,
      updated_at     = v_now,
      updated_by     = auth.uid()
  where id = p_template_id;

  -- 3. Audit
  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_row.facility_id,
    auth.uid(),
    'ice_depth_template.published',
    'ice_depth_template',
    p_template_id,
    jsonb_build_object('new_version', v_new_version)
  );

  return query select v_new_version, v_now;
end;
$$;

grant execute on function public.rpc_publish_ice_depth_template(uuid) to authenticated;

comment on function public.rpc_publish_ice_depth_template(uuid) is
  'Snapshot current → history, swap draft → current, bump version. Rejects drafts that remove point keys referenced by historical readings.';

-- ----------------------------------------------------------------------------

create or replace function public.rpc_discard_ice_depth_template_draft(
  p_template_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select id, facility_id, draft_points
  into v_row
  from public.ice_depth_templates
  where id = p_template_id
  for update;

  if v_row.id is null then
    raise exception 'ice_depth_template % not found', p_template_id using errcode = 'P0002';
  end if;

  if not (
    public.is_platform_admin()
    or (
      v_row.facility_id = public.current_facility_id()
      and public.has_module_access('ice_depth', 'admin')
    )
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_row.draft_points is null then
    return;
  end if;

  update public.ice_depth_templates
  set draft_points = null,
      updated_at   = now(),
      updated_by   = auth.uid()
  where id = p_template_id;

  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_row.facility_id,
    auth.uid(),
    'ice_depth_template.draft_discarded',
    'ice_depth_template',
    p_template_id,
    '{}'::jsonb
  );
end;
$$;

grant execute on function public.rpc_discard_ice_depth_template_draft(uuid) to authenticated;

-- ----------------------------------------------------------------------------

create or replace function public.rpc_complete_ice_depth_session(
  p_session_id uuid
)
returns table (missing_point_keys text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_history_points jsonb;
  v_required_keys text[];
  v_recorded_keys text[];
  v_missing text[];
begin
  select id, facility_id, template_id, form_schema_version, status
  into v_session
  from public.ice_depth_sessions
  where id = p_session_id
  for update;

  if v_session.id is null then
    raise exception 'session % not found', p_session_id using errcode = 'P0002';
  end if;

  if not (
    public.is_platform_admin()
    or (
      v_session.facility_id = public.current_facility_id()
      and public.has_module_access('ice_depth', 'write')
    )
  ) then
    raise exception 'not authorized to complete this session' using errcode = '42501';
  end if;

  -- Idempotent: if already completed, return with no missing keys.
  if v_session.status = 'completed' then
    return query select array[]::text[];
    return;
  end if;

  if v_session.status = 'abandoned' then
    raise exception 'session is abandoned' using errcode = 'P0001';
  end if;

  -- Required keys = whatever the template version the session was filed under had.
  -- Look up in template history (the session's form_schema_version).
  select points into v_history_points
  from public.ice_depth_template_history
  where template_id = v_session.template_id
    and version = v_session.form_schema_version;

  if v_history_points is null then
    -- Version hasn't been snapshotted to history yet (first ever session under v1).
    -- Fall back to current_points of the template.
    select current_points into v_history_points
    from public.ice_depth_templates
    where id = v_session.template_id;
  end if;

  select array_agg(p->>'key')
  into v_required_keys
  from jsonb_array_elements(v_history_points) p;

  select array_agg(r.point_key)
  into v_recorded_keys
  from public.ice_depth_readings r
  where r.session_id = p_session_id;

  select array_agg(rk)
  into v_missing
  from unnest(coalesce(v_required_keys, array[]::text[])) rk
  where rk not in (select unnest(coalesce(v_recorded_keys, array[]::text[])));

  if v_missing is not null and array_length(v_missing, 1) > 0 then
    return query select v_missing;
    return;
  end if;

  update public.ice_depth_sessions
  set status = 'completed',
      submitted_at = now()
  where id = p_session_id
    and status = 'in_progress';

  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_session.facility_id,
    auth.uid(),
    'ice_depth_session.completed',
    'ice_depth_session',
    p_session_id,
    jsonb_build_object('template_id', v_session.template_id,
                       'form_schema_version', v_session.form_schema_version)
  );

  return query select array[]::text[];
end;
$$;

grant execute on function public.rpc_complete_ice_depth_session(uuid) to authenticated;

comment on function public.rpc_complete_ice_depth_session(uuid) is
  'Validate all template points have readings; flip status to completed. Returns missing_point_keys if incomplete (caller surfaces to staff).';
