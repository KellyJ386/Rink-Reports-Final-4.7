-- 20260427000002_fix_rpc_time_off_decide.sql
--
-- The original rpc_time_off_decide function declares:
--   returns table (request_id uuid, user_id uuid, status text)
-- PL/pgSQL treats the RETURNS TABLE column names as implicit output variables.
-- The function body then runs:
--   select id, facility_id, user_id, status into v_req from public.time_off_requests ...
-- PostgreSQL cannot distinguish between the column "user_id" in time_off_requests
-- and the implicit PL/pgSQL out-variable "user_id" declared by RETURNS TABLE.
-- Same ambiguity exists for "status".  This produces SQLSTATE 42702
-- ("column reference is ambiguous") and causes every call to fail.
--
-- Fix: qualify every column reference in the SELECT … INTO statement with an
-- explicit table alias so the resolver sees "tor.user_id" (table column) rather
-- than the bare "user_id" (which matches both the table column and the implicit
-- PL/pgSQL variable).

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

  -- Use table alias "tor" so "tor.user_id" and "tor.status" are unambiguous
  -- (they refer to the table columns, not the implicit RETURNS TABLE variables).
  select tor.id, tor.facility_id, tor.user_id, tor.status
    into v_req
    from public.time_off_requests tor
    where tor.id = p_request_id
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
