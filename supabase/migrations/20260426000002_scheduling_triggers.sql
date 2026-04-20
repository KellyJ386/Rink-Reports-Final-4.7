-- 20260426000002_scheduling_triggers.sql
-- Agent 5 — Scheduling constraints that can't be expressed as static checks.
--
-- 1. shifts.position_resource_id must reference a facility_resources row with
--    resource_type = 'shift_position' AND the same facility_id.
-- 2. shift_assignments.user_id must belong to the same facility as the shift.
-- 3. Overlap-block: same user cannot have two shifts whose tstzrange overlaps
--    within ±24h of each other, excluding shifts on archived schedules.
--    Raised as errcode '23P01' (exclusion_violation) with a clear message so
--    server actions can translate it into user-friendly copy.

-- ============================================================================
-- shifts.position_resource_id must be a shift_position in the same facility
-- ============================================================================

create or replace function public.tg_shifts_position_resource_check()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_resource_facility uuid;
  v_resource_type     text;
begin
  select facility_id, resource_type
    into v_resource_facility, v_resource_type
    from public.facility_resources
    where id = new.position_resource_id;

  if v_resource_facility is null then
    raise exception 'shifts.position_resource_id % not found', new.position_resource_id
      using errcode = '23503';
  end if;

  if v_resource_type <> 'shift_position' then
    raise exception 'shifts.position_resource_id must reference a shift_position resource, got %', v_resource_type
      using errcode = '23514';
  end if;

  if v_resource_facility <> new.facility_id then
    raise exception 'shifts.position_resource_id belongs to a different facility'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists shifts_position_resource_check on public.shifts;
create trigger shifts_position_resource_check
  before insert or update of position_resource_id, facility_id on public.shifts
  for each row execute function public.tg_shifts_position_resource_check();

-- ============================================================================
-- shift_assignments.user_id must be in the same facility as the shift
-- ============================================================================

create or replace function public.tg_shift_assignments_facility_match()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_shift_facility uuid;
  v_user_facility  uuid;
begin
  select facility_id into v_shift_facility from public.shifts where id = new.shift_id;
  select facility_id into v_user_facility  from public.users  where id = new.user_id;

  if v_shift_facility is null or v_user_facility is null then
    raise exception 'shift_assignments references missing shift or user'
      using errcode = '23503';
  end if;

  if v_shift_facility <> v_user_facility then
    raise exception 'shift_assignments: user and shift must be in the same facility'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists shift_assignments_facility_match on public.shift_assignments;
create trigger shift_assignments_facility_match
  before insert or update on public.shift_assignments
  for each row execute function public.tg_shift_assignments_facility_match();

-- ============================================================================
-- Overlap-block: same user, any shift whose tstzrange overlaps within ±24h of
-- the target, excluding shifts whose schedule.status = 'archived'.
-- ============================================================================
--
-- The ±24h window means: if the target shift runs 6am–2pm Mon, we check for
-- any existing assignment on shifts that intersect (Sun 6am – Tue 2pm) using
-- tstzrange && semantics. This is wider than strict overlap but catches
-- back-to-back double-books where a rink's 11pm–7am shift would otherwise
-- coexist with a 9am–5pm same-day shift (a real risk).
--
-- Idempotency note: if the same row is re-inserted (same assignment_id won't
-- happen because PK generates uuid, but same (shift_id, user_id) is blocked
-- by the unique constraint — the overlap trigger never sees it). The trigger
-- only scans for DIFFERENT assignments belonging to the same user.

create or replace function public.tg_shift_assignments_overlap_block()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_shift         record;
  v_target_range  tstzrange;
  v_check_range   tstzrange;
  v_conflict      record;
begin
  select id, schedule_id, starts_at, ends_at, facility_id
    into v_shift
    from public.shifts
    where id = new.shift_id;

  if v_shift.id is null then
    return new;  -- FK trigger will reject separately
  end if;

  v_target_range := tstzrange(v_shift.starts_at, v_shift.ends_at, '[)');
  v_check_range  := tstzrange(
    v_shift.starts_at - interval '24 hours',
    v_shift.ends_at   + interval '24 hours',
    '[)'
  );

  select sa.id, sh.starts_at, sh.ends_at, sh.id as shift_id
    into v_conflict
    from public.shift_assignments sa
    join public.shifts sh on sh.id = sa.shift_id
    join public.schedules sc on sc.id = sh.schedule_id
    where sa.user_id = new.user_id
      and sa.shift_id <> new.shift_id
      and sh.facility_id = v_shift.facility_id
      and sc.status <> 'archived'
      and tstzrange(sh.starts_at, sh.ends_at, '[)') && v_check_range
      and tstzrange(sh.starts_at, sh.ends_at, '[)') && v_target_range
    limit 1;

  if v_conflict.id is not null then
    raise exception
      'shift_assignments: user % already assigned to an overlapping shift (% to %)',
      new.user_id, v_conflict.starts_at, v_conflict.ends_at
      using errcode = '23P01',
            hint = format('conflicting_shift_id=%s', v_conflict.shift_id);
  end if;

  return new;
end;
$$;

drop trigger if exists shift_assignments_overlap_block on public.shift_assignments;
create trigger shift_assignments_overlap_block
  before insert or update of shift_id, user_id on public.shift_assignments
  for each row execute function public.tg_shift_assignments_overlap_block();

comment on function public.tg_shift_assignments_overlap_block is
  'Blocks same-user shift overlap within ±24h of target range. Excludes archived schedules. Raises SQLSTATE 23P01 (exclusion_violation) with hint=conflicting_shift_id=<uuid> so server actions can look up the conflict and produce a user-friendly message.';
