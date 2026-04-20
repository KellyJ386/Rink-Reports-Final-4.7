-- 20260426000003_scheduling_fns.sql
-- Agent 5 — Scheduling RPCs + the effective-availability helper.
--
-- All RPCs are SECURITY DEFINER with explicit auth checks so they can do
-- multi-table mutations atomically. Publishing a schedule + writing the audit
-- entry happens in one transaction; notification fan-out happens in the lib
-- layer after the RPC returns (to avoid long-held locks on audit_log during
-- N-recipient publishNotification loops).

-- ============================================================================
-- effective_availability_for_week(user_id, week_start_date)
-- ============================================================================
--
-- Day-level additive overrides: for each day of the week (0..6), if the user
-- has override rows for THAT DAY, return them; otherwise fall back to the
-- template rows for that day. Days with neither yield no rows for the caller
-- to interpret as "no availability submitted".

create or replace function public.effective_availability_for_week(
  p_user_id uuid,
  p_week_start_date date
)
returns table (
  day_of_week smallint,
  start_time  time,
  end_time    time,
  status      text,
  source      text  -- 'override' | 'template'
)
language sql
stable
set search_path = public
as $$
  with override_days as (
    select distinct day_of_week
    from public.availability_overrides
    where user_id = p_user_id and week_start_date = p_week_start_date
  )
  select o.day_of_week, o.start_time, o.end_time, o.status, 'override'::text as source
    from public.availability_overrides o
    where o.user_id = p_user_id and o.week_start_date = p_week_start_date
  union all
  select t.day_of_week, t.start_time, t.end_time, t.status, 'template'::text as source
    from public.availability_templates t
    where t.user_id = p_user_id
      and t.day_of_week not in (select day_of_week from override_days);
$$;

grant execute on function public.effective_availability_for_week(uuid, date) to authenticated;

comment on function public.effective_availability_for_week is
  'Additive per-day availability computation. Day has override rows → those replace template for that day; no override → template applies; neither → day returns no rows (interpret as "no availability submitted").';

-- ============================================================================
-- rpc_publish_schedule
-- ============================================================================
-- Flips status → 'published' atomically with audit_log write. Errors if
-- already published. Returns the schedule id + a list of assigned user_ids
-- so the lib layer can fan out notifications.

create or replace function public.rpc_publish_schedule(
  p_schedule_id uuid
)
returns table (
  schedule_id uuid,
  week_start_date date,
  assigned_user_ids uuid[]
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_schedule record;
  v_users    uuid[];
begin
  select id, facility_id, week_start_date, status
    into v_schedule
    from public.schedules
    where id = p_schedule_id
    for update;

  if v_schedule.id is null then
    raise exception 'schedule % not found', p_schedule_id using errcode = 'P0002';
  end if;

  if v_schedule.status = 'published' then
    raise exception 'schedule already published' using errcode = '22023';
  end if;

  if v_schedule.status = 'archived' then
    raise exception 'cannot publish an archived schedule' using errcode = '22023';
  end if;

  if not (
    public.is_platform_admin()
    or (
      v_schedule.facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'admin')
    )
  ) then
    raise exception 'not authorized to publish this schedule' using errcode = '42501';
  end if;

  update public.schedules
    set status       = 'published',
        published_at = now(),
        published_by = auth.uid()
    where id = p_schedule_id;

  select coalesce(array_agg(distinct sa.user_id), array[]::uuid[])
    into v_users
    from public.shift_assignments sa
    join public.shifts sh on sh.id = sa.shift_id
    where sh.schedule_id = p_schedule_id;

  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_schedule.facility_id,
    auth.uid(),
    'schedule.published',
    'schedule',
    p_schedule_id,
    jsonb_build_object(
      'week_start_date', v_schedule.week_start_date,
      'assigned_user_count', coalesce(array_length(v_users, 1), 0)
    )
  );

  return query
    select v_schedule.id, v_schedule.week_start_date, v_users;
end;
$$;

grant execute on function public.rpc_publish_schedule(uuid) to authenticated;

-- ============================================================================
-- rpc_reopen_schedule
-- ============================================================================
-- Flips published → draft. Archive remains terminal.

create or replace function public.rpc_reopen_schedule(
  p_schedule_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_schedule record;
begin
  select id, facility_id, status, week_start_date
    into v_schedule
    from public.schedules
    where id = p_schedule_id
    for update;

  if v_schedule.id is null then
    raise exception 'schedule % not found', p_schedule_id using errcode = 'P0002';
  end if;

  if v_schedule.status <> 'published' then
    raise exception 'only published schedules can be reopened' using errcode = '22023';
  end if;

  if not (
    public.is_platform_admin()
    or (
      v_schedule.facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'admin')
    )
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.schedules
    set status       = 'draft',
        published_at = null,
        published_by = null
    where id = p_schedule_id;

  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_schedule.facility_id,
    auth.uid(),
    'schedule.reopened',
    'schedule',
    p_schedule_id,
    jsonb_build_object('week_start_date', v_schedule.week_start_date)
  );
end;
$$;

grant execute on function public.rpc_reopen_schedule(uuid) to authenticated;

-- ============================================================================
-- rpc_archive_schedule
-- ============================================================================

create or replace function public.rpc_archive_schedule(
  p_schedule_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_schedule record;
begin
  select id, facility_id, status, week_start_date
    into v_schedule
    from public.schedules
    where id = p_schedule_id
    for update;

  if v_schedule.id is null then
    raise exception 'schedule % not found', p_schedule_id using errcode = 'P0002';
  end if;

  if v_schedule.status = 'archived' then
    return;  -- idempotent
  end if;

  if not (
    public.is_platform_admin()
    or (
      v_schedule.facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'admin')
    )
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.schedules
    set status      = 'archived',
        archived_at = now(),
        archived_by = auth.uid()
    where id = p_schedule_id;

  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_schedule.facility_id,
    auth.uid(),
    'schedule.archived',
    'schedule',
    p_schedule_id,
    jsonb_build_object('week_start_date', v_schedule.week_start_date)
  );
end;
$$;

grant execute on function public.rpc_archive_schedule(uuid) to authenticated;

-- ============================================================================
-- rpc_time_off_decide
-- ============================================================================

create or replace function public.rpc_time_off_decide(
  p_request_id uuid,
  p_decision   text,  -- 'approved' | 'denied'
  p_note       text default null
)
returns table (
  request_id uuid,
  user_id    uuid,
  status     text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req record;
begin
  if p_decision not in ('approved', 'denied') then
    raise exception 'rpc_time_off_decide: p_decision must be approved or denied'
      using errcode = '22023';
  end if;

  select id, facility_id, user_id, status
    into v_req
    from public.time_off_requests
    where id = p_request_id
    for update;

  if v_req.id is null then
    raise exception 'time_off_request % not found', p_request_id using errcode = 'P0002';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'time_off_request is not pending (current: %)', v_req.status
      using errcode = '22023';
  end if;

  if not (
    public.is_platform_admin()
    or (
      v_req.facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'admin')
    )
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.time_off_requests
    set status        = p_decision,
        decided_by    = auth.uid(),
        decided_at    = now(),
        decision_note = p_note
    where id = p_request_id;

  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_req.facility_id,
    auth.uid(),
    'time_off.decided',
    'time_off_request',
    p_request_id,
    jsonb_build_object('decision', p_decision, 'note', coalesce(p_note, ''))
  );

  return query
    select v_req.id, v_req.user_id, p_decision;
end;
$$;

grant execute on function public.rpc_time_off_decide(uuid, text, text) to authenticated;

-- ============================================================================
-- rpc_time_off_withdraw
-- ============================================================================
-- Staff-self only. If already approved, flip to withdrawn but leave the
-- schedule alone (don't try to auto-reassign) and flag
-- schedule_adjusted_before_withdraw = true so managers see in the log that
-- they adjusted around it. Returns the decided_by so the caller can notify
-- the approving manager.

create or replace function public.rpc_time_off_withdraw(
  p_request_id uuid
)
returns table (
  request_id     uuid,
  previous_status text,
  notify_manager_user_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req record;
  v_was_approved boolean;
begin
  select id, facility_id, user_id, status, decided_by
    into v_req
    from public.time_off_requests
    where id = p_request_id
    for update;

  if v_req.id is null then
    raise exception 'time_off_request % not found', p_request_id using errcode = 'P0002';
  end if;

  if v_req.status = 'withdrawn' then
    return query select v_req.id, 'withdrawn'::text, null::uuid;
    return;
  end if;

  if v_req.status = 'denied' then
    raise exception 'cannot withdraw a denied request' using errcode = '22023';
  end if;

  if not (
    public.is_platform_admin() or v_req.user_id = auth.uid()
  ) then
    raise exception 'only the requester may withdraw' using errcode = '42501';
  end if;

  v_was_approved := (v_req.status = 'approved');

  update public.time_off_requests
    set status = 'withdrawn',
        schedule_adjusted_before_withdraw = v_was_approved,
        decided_by = null,
        decided_at = null,
        decision_note = case
          when v_was_approved then
            coalesce(decision_note, '') ||
            case when length(coalesce(decision_note, '')) > 0 then E'\n' else '' end ||
            '[withdrawn after approval; schedule was not auto-reverted]'
          else decision_note
        end
    where id = p_request_id;

  if v_was_approved then
    insert into public.audit_log
      (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
    values (
      v_req.facility_id,
      auth.uid(),
      'time_off.withdrawn_after_approval',
      'time_off_request',
      p_request_id,
      jsonb_build_object('previous_status', 'approved')
    );
  end if;

  return query
    select v_req.id,
           case when v_was_approved then 'approved'::text else 'pending'::text end,
           v_req.decided_by;
end;
$$;

grant execute on function public.rpc_time_off_withdraw(uuid) to authenticated;

-- ============================================================================
-- rpc_swap_accept — target accepts the swap.
-- ============================================================================
-- In manager_approval mode: transitions pending_target → pending_manager.
-- In free mode: calls rpc_swap_reassign internally which reassigns and
-- transitions directly to approved.

create or replace function public.rpc_swap_accept(
  p_swap_id uuid
)
returns table (
  swap_id      uuid,
  new_status   text,
  reassigned   boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_swap       record;
  v_mode       text;
  v_reassigned boolean := false;
begin
  select id, facility_id, requester_user_id, requester_shift_id,
         target_user_id, target_shift_id, status
    into v_swap
    from public.shift_swap_requests
    where id = p_swap_id
    for update;

  if v_swap.id is null then
    raise exception 'swap % not found', p_swap_id using errcode = 'P0002';
  end if;

  if v_swap.status <> 'pending_target' then
    raise exception 'swap is not pending target (current: %)', v_swap.status
      using errcode = '22023';
  end if;

  if not (public.is_platform_admin() or v_swap.target_user_id = auth.uid()) then
    raise exception 'only the swap target may accept' using errcode = '42501';
  end if;

  select coalesce(f.settings->'scheduling'->>'swap_approval_mode', 'manager_approval')
    into v_mode
    from public.facilities f
    where f.id = v_swap.facility_id;

  if v_mode = 'free' then
    -- Accept + reassign atomically
    perform public._internal_swap_reassign(p_swap_id);
    v_reassigned := true;
    update public.shift_swap_requests
      set status = 'approved',
          target_response_at = now(),
          decided_by = auth.uid(),
          decided_at = now()
      where id = p_swap_id;

    insert into public.audit_log
      (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
    values (
      v_swap.facility_id, auth.uid(),
      'swap.approved', 'shift_swap_request', p_swap_id,
      jsonb_build_object('mode', 'free')
    );

    return query select v_swap.id, 'approved'::text, true;
    return;
  else
    -- manager_approval: just flip to pending_manager
    update public.shift_swap_requests
      set status = 'pending_manager',
          target_response_at = now()
      where id = p_swap_id;

    return query select v_swap.id, 'pending_manager'::text, false;
    return;
  end if;
end;
$$;

grant execute on function public.rpc_swap_accept(uuid) to authenticated;

-- ============================================================================
-- rpc_swap_manager_decide — approve or deny a pending_manager swap.
-- ============================================================================

create or replace function public.rpc_swap_manager_decide(
  p_swap_id  uuid,
  p_decision text,  -- 'approved' | 'denied'
  p_note     text default null
)
returns table (
  swap_id    uuid,
  new_status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_swap record;
begin
  if p_decision not in ('approved', 'denied') then
    raise exception 'p_decision must be approved or denied' using errcode = '22023';
  end if;

  select id, facility_id, status
    into v_swap
    from public.shift_swap_requests
    where id = p_swap_id
    for update;

  if v_swap.id is null then
    raise exception 'swap % not found', p_swap_id using errcode = 'P0002';
  end if;

  if v_swap.status <> 'pending_manager' then
    raise exception 'swap is not pending manager approval (current: %)', v_swap.status
      using errcode = '22023';
  end if;

  if not (
    public.is_platform_admin()
    or (
      v_swap.facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'admin')
    )
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_decision = 'approved' then
    perform public._internal_swap_reassign(p_swap_id);
  end if;

  update public.shift_swap_requests
    set status        = p_decision,
        decided_by    = auth.uid(),
        decided_at    = now(),
        decision_note = p_note
    where id = p_swap_id;

  insert into public.audit_log
    (facility_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    v_swap.facility_id, auth.uid(),
    case when p_decision = 'approved' then 'swap.approved' else 'swap.rejected' end,
    'shift_swap_request', p_swap_id,
    jsonb_build_object('mode', 'manager_approval', 'note', coalesce(p_note, ''))
  );

  return query select v_swap.id, p_decision;
end;
$$;

grant execute on function public.rpc_swap_manager_decide(uuid, text, text) to authenticated;

-- ============================================================================
-- rpc_swap_withdraw — either party can withdraw before final approval.
-- ============================================================================

create or replace function public.rpc_swap_withdraw(
  p_swap_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_swap record;
begin
  select id, facility_id, requester_user_id, target_user_id, status
    into v_swap
    from public.shift_swap_requests
    where id = p_swap_id
    for update;

  if v_swap.id is null then
    raise exception 'swap % not found', p_swap_id using errcode = 'P0002';
  end if;

  if v_swap.status in ('approved', 'denied', 'withdrawn') then
    raise exception 'swap already finalized (%)', v_swap.status using errcode = '22023';
  end if;

  if not (
    public.is_platform_admin()
    or v_swap.requester_user_id = auth.uid()
    or v_swap.target_user_id    = auth.uid()
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.shift_swap_requests
    set status = 'withdrawn',
        decided_by = auth.uid(),
        decided_at = now()
    where id = p_swap_id;
end;
$$;

grant execute on function public.rpc_swap_withdraw(uuid) to authenticated;

-- ============================================================================
-- _internal_swap_reassign — atomic shift_assignments rewrite for a swap.
-- ============================================================================
-- Not callable by authenticated; internal helper invoked from within the
-- SECURITY DEFINER rpc_swap_* functions. The overlap-block trigger on
-- shift_assignments fires per row; we DELETE first then INSERT so the trigger
-- sees a consistent state.

create or replace function public._internal_swap_reassign(
  p_swap_id uuid
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_swap record;
begin
  select id, requester_user_id, requester_shift_id,
         target_user_id, target_shift_id
    into v_swap
    from public.shift_swap_requests
    where id = p_swap_id;

  -- Remove requester from their shift; assign target instead
  delete from public.shift_assignments
    where shift_id = v_swap.requester_shift_id
      and user_id  = v_swap.requester_user_id;

  insert into public.shift_assignments (shift_id, user_id, assigned_by)
    values (v_swap.requester_shift_id, v_swap.target_user_id, auth.uid());

  -- Mirror for target_shift if it's a two-way swap (nullable = giveaway)
  if v_swap.target_shift_id is not null then
    delete from public.shift_assignments
      where shift_id = v_swap.target_shift_id
        and user_id  = v_swap.target_user_id;

    insert into public.shift_assignments (shift_id, user_id, assigned_by)
      values (v_swap.target_shift_id, v_swap.requester_user_id, auth.uid());
  end if;
end;
$$;

revoke all on function public._internal_swap_reassign(uuid) from public;
revoke all on function public._internal_swap_reassign(uuid) from authenticated;
