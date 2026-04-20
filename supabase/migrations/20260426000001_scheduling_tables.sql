-- 20260426000001_scheduling_tables.sql
-- Agent 5 — Employee Scheduling: 7 tables + RLS.
--
-- All tables tenant-scoped; facility_id defaults to current_facility_id() so
-- the client cannot forge it. week_start_date Sunday enforcement via CHECK
-- constraints (EXTRACT(DOW)=0). Overlap-block for shift_assignments lives in
-- the next migration as a BEFORE trigger that uses tstzrange && semantics.
--
-- Permission model per SCHEDULING.md:
--   Staff   = 'write' (own availability, time-off, swaps; read own shifts)
--   Manager = 'admin' (full schedule builder, approvals)
--   Admin   = 'admin' (same as manager + facility config, which is Agent 6)
--
-- Why module access 'admin' for managers rather than 'write': 'write' is
-- inherited by Staff, and Staff cannot approve their coworker's time-off.
-- Module-access levels map to action scopes: read = see own/assigned, write =
-- submit own requests, admin = approve + build + audit across the facility.

-- ============================================================================
-- schedules
-- ============================================================================

create table if not exists public.schedules (
  id               uuid primary key default gen_random_uuid(),
  facility_id      uuid not null default public.current_facility_id()
                     references public.facilities(id) on delete cascade,
  week_start_date  date not null,
  status           text not null default 'draft'
                     check (status in ('draft', 'published', 'archived')),
  created_by       uuid not null references public.users(id) on delete restrict,
  created_at       timestamptz not null default now(),
  published_at     timestamptz,
  published_by     uuid references public.users(id) on delete set null,
  archived_at      timestamptz,
  archived_by      uuid references public.users(id) on delete set null,

  constraint schedules_week_start_sunday_chk
    check (extract(dow from week_start_date) = 0),
  constraint schedules_publish_consistency_chk
    check (
      (status = 'draft'     and published_at is null  and published_by is null)
      or (status = 'published' and published_at is not null and published_by is not null)
      or (status = 'archived' and archived_at  is not null and archived_by  is not null)
    )
);

create unique index if not exists schedules_facility_week_key
  on public.schedules (facility_id, week_start_date);

create index if not exists schedules_facility_status_week_idx
  on public.schedules (facility_id, status, week_start_date desc);

alter table public.schedules enable row level security;

-- ============================================================================
-- shifts
-- ============================================================================

create table if not exists public.shifts (
  id                   uuid primary key default gen_random_uuid(),
  facility_id          uuid not null default public.current_facility_id()
                         references public.facilities(id) on delete cascade,
  schedule_id          uuid not null references public.schedules(id) on delete cascade,
  position_resource_id uuid not null references public.facility_resources(id) on delete restrict,
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  notes                text,
  required_headcount   integer not null default 1 check (required_headcount >= 1),
  created_at           timestamptz not null default now(),

  constraint shifts_timerange_chk check (ends_at > starts_at)
);

create index if not exists shifts_schedule_idx
  on public.shifts (schedule_id);

create index if not exists shifts_facility_start_idx
  on public.shifts (facility_id, starts_at);

create index if not exists shifts_position_idx
  on public.shifts (position_resource_id, starts_at);

-- GiST index supporting tstzrange overlap queries (used by the overlap-block
-- trigger in migration 2). Deliberately not composite with facility_id — that
-- would require the btree_gist extension; the overlap-block query joins to
-- shifts and filters by facility_id separately, and RLS already scopes reads.
create index if not exists shifts_tstzrange_gist_idx
  on public.shifts using gist (tstzrange(starts_at, ends_at));

alter table public.shifts enable row level security;

-- ============================================================================
-- shift_assignments
-- ============================================================================

create table if not exists public.shift_assignments (
  id            uuid primary key default gen_random_uuid(),
  shift_id      uuid not null references public.shifts(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  assigned_at   timestamptz not null default now(),
  assigned_by   uuid references public.users(id) on delete set null,

  constraint shift_assignments_shift_user_key unique (shift_id, user_id)
);

create index if not exists shift_assignments_user_idx
  on public.shift_assignments (user_id);

alter table public.shift_assignments enable row level security;

-- ============================================================================
-- availability_templates (recurring weekly defaults)
-- ============================================================================

create table if not exists public.availability_templates (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null default public.current_facility_id()
                   references public.facilities(id) on delete cascade,
  user_id        uuid not null references public.users(id) on delete cascade,
  day_of_week    smallint not null check (day_of_week between 0 and 6),
  start_time     time not null,
  end_time       time not null,
  status         text not null
                   check (status in ('available', 'unavailable', 'preferred')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint availability_templates_timerange_chk check (end_time > start_time)
);

create index if not exists availability_templates_user_dow_idx
  on public.availability_templates (user_id, day_of_week);

drop trigger if exists availability_templates_touch_updated_at
  on public.availability_templates;
create trigger availability_templates_touch_updated_at
  before update on public.availability_templates
  for each row execute function public.tg_touch_updated_at();

alter table public.availability_templates enable row level security;

-- ============================================================================
-- availability_overrides (per-week, additive on top of template)
-- ============================================================================
-- Day-level granularity: an override row for (user, week_start, day) replaces
-- the template for THAT DAY only. Days without an override row fall back to
-- the template. Days with neither render as "no availability submitted" in
-- the UI.

create table if not exists public.availability_overrides (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null default public.current_facility_id()
                    references public.facilities(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  week_start_date date not null,
  day_of_week     smallint not null check (day_of_week between 0 and 6),
  start_time      time not null,
  end_time        time not null,
  status          text not null
                    check (status in ('available', 'unavailable', 'preferred')),
  created_at      timestamptz not null default now(),

  constraint availability_overrides_week_sunday_chk
    check (extract(dow from week_start_date) = 0),
  constraint availability_overrides_timerange_chk check (end_time > start_time)
);

create index if not exists availability_overrides_user_week_idx
  on public.availability_overrides (user_id, week_start_date, day_of_week);

alter table public.availability_overrides enable row level security;

-- ============================================================================
-- time_off_requests
-- ============================================================================

create table if not exists public.time_off_requests (
  id               uuid primary key default gen_random_uuid(),
  facility_id      uuid not null default public.current_facility_id()
                     references public.facilities(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  reason           text,
  status           text not null default 'pending'
                     check (status in ('pending', 'approved', 'denied', 'withdrawn')),
  decided_by       uuid references public.users(id) on delete set null,
  decided_at       timestamptz,
  decision_note    text,
  schedule_adjusted_before_withdraw boolean not null default false,
  created_at       timestamptz not null default now(),
  idempotency_key  text,

  constraint time_off_timerange_chk check (ends_at > starts_at),
  constraint time_off_decided_consistency_chk check (
    (status in ('pending', 'withdrawn') and decided_by is null and decided_at is null)
    or (status in ('approved', 'denied') and decided_by is not null and decided_at is not null)
  )
);

create index if not exists time_off_user_status_idx
  on public.time_off_requests (user_id, status, starts_at desc);

create index if not exists time_off_facility_pending_idx
  on public.time_off_requests (facility_id, starts_at desc)
  where status = 'pending';

create unique index if not exists time_off_idempotency_key
  on public.time_off_requests (facility_id, idempotency_key)
  where idempotency_key is not null;

alter table public.time_off_requests enable row level security;

-- ============================================================================
-- shift_swap_requests
-- ============================================================================

create table if not exists public.shift_swap_requests (
  id                   uuid primary key default gen_random_uuid(),
  facility_id          uuid not null default public.current_facility_id()
                         references public.facilities(id) on delete cascade,
  requester_user_id    uuid not null references public.users(id) on delete cascade,
  requester_shift_id   uuid not null references public.shifts(id) on delete cascade,
  target_user_id       uuid not null references public.users(id) on delete cascade,
  target_shift_id      uuid references public.shifts(id) on delete cascade,
  status               text not null default 'pending_target'
                         check (status in (
                           'pending_target', 'pending_manager',
                           'approved', 'denied', 'withdrawn'
                         )),
  target_response_at   timestamptz,
  decided_by           uuid references public.users(id) on delete set null,
  decided_at           timestamptz,
  decision_note        text,
  created_at           timestamptz not null default now(),
  idempotency_key      text,

  constraint shift_swap_requester_not_target_chk
    check (requester_user_id <> target_user_id)
);

create index if not exists shift_swap_target_status_idx
  on public.shift_swap_requests (target_user_id, status);

create index if not exists shift_swap_requester_status_idx
  on public.shift_swap_requests (requester_user_id, status);

create index if not exists shift_swap_facility_pending_idx
  on public.shift_swap_requests (facility_id, status, created_at desc)
  where status in ('pending_target', 'pending_manager');

create unique index if not exists shift_swap_idempotency_key
  on public.shift_swap_requests (facility_id, idempotency_key)
  where idempotency_key is not null;

alter table public.shift_swap_requests enable row level security;

-- ============================================================================
-- RLS policies
-- ============================================================================

-- schedules: staff read, admins write
drop policy if exists schedules_select on public.schedules;
create policy schedules_select on public.schedules
  for select to authenticated
  using (
    public.is_platform_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'read')
    )
  );

drop policy if exists schedules_insert on public.schedules;
create policy schedules_insert on public.schedules
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'admin')
      and created_by = (select auth.uid())
    )
  );

drop policy if exists schedules_update on public.schedules;
create policy schedules_update on public.schedules
  for update to authenticated
  using (
    public.is_platform_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'admin')
    )
  )
  with check (
    public.is_platform_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'admin')
    )
  );

-- shifts: staff see shifts on published schedules for their facility; admins see all + write
drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts
  for select to authenticated
  using (
    public.is_platform_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_access('scheduling', 'admin')
        or (
          public.has_module_access('scheduling', 'read')
          and exists (
            select 1 from public.schedules s
            where s.id = shifts.schedule_id and s.status = 'published'
          )
        )
      )
    )
  );

drop policy if exists shifts_insert on public.shifts;
create policy shifts_insert on public.shifts
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'admin')
    )
  );

drop policy if exists shifts_update on public.shifts;
create policy shifts_update on public.shifts
  for update to authenticated
  using (
    public.is_platform_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'admin')
    )
  )
  with check (
    public.is_platform_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'admin')
    )
  );

drop policy if exists shifts_delete on public.shifts;
create policy shifts_delete on public.shifts
  for delete to authenticated
  using (
    public.is_platform_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'admin')
    )
  );

-- shift_assignments: staff see own + others on same published shift; admins write
drop policy if exists shift_assignments_select on public.shift_assignments;
create policy shift_assignments_select on public.shift_assignments
  for select to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.shifts sh
      join public.schedules sc on sc.id = sh.schedule_id
      where sh.id = shift_assignments.shift_id
        and sh.facility_id = public.current_facility_id()
        and (
          public.has_module_access('scheduling', 'admin')
          or (
            public.has_module_access('scheduling', 'read')
            and sc.status = 'published'
          )
        )
    )
  );

drop policy if exists shift_assignments_insert on public.shift_assignments;
create policy shift_assignments_insert on public.shift_assignments
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or exists (
      select 1 from public.shifts sh
      where sh.id = shift_assignments.shift_id
        and sh.facility_id = public.current_facility_id()
        and public.has_module_access('scheduling', 'admin')
    )
  );

drop policy if exists shift_assignments_delete on public.shift_assignments;
create policy shift_assignments_delete on public.shift_assignments
  for delete to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.shifts sh
      where sh.id = shift_assignments.shift_id
        and sh.facility_id = public.current_facility_id()
        and public.has_module_access('scheduling', 'admin')
    )
  );

-- availability_templates: user manages own; admins read all in facility
drop policy if exists availability_templates_select on public.availability_templates;
create policy availability_templates_select on public.availability_templates
  for select to authenticated
  using (
    public.is_platform_admin()
    or user_id = (select auth.uid())
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'admin')
    )
  );

drop policy if exists availability_templates_insert on public.availability_templates;
create policy availability_templates_insert on public.availability_templates
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (
      user_id = (select auth.uid())
      and facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'write')
    )
  );

drop policy if exists availability_templates_update on public.availability_templates;
create policy availability_templates_update on public.availability_templates
  for update to authenticated
  using (public.is_platform_admin() or user_id = (select auth.uid()))
  with check (public.is_platform_admin() or user_id = (select auth.uid()));

drop policy if exists availability_templates_delete on public.availability_templates;
create policy availability_templates_delete on public.availability_templates
  for delete to authenticated
  using (public.is_platform_admin() or user_id = (select auth.uid()));

-- availability_overrides: same ownership model
drop policy if exists availability_overrides_select on public.availability_overrides;
create policy availability_overrides_select on public.availability_overrides
  for select to authenticated
  using (
    public.is_platform_admin()
    or user_id = (select auth.uid())
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'admin')
    )
  );

drop policy if exists availability_overrides_insert on public.availability_overrides;
create policy availability_overrides_insert on public.availability_overrides
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (
      user_id = (select auth.uid())
      and facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'write')
    )
  );

drop policy if exists availability_overrides_delete on public.availability_overrides;
create policy availability_overrides_delete on public.availability_overrides
  for delete to authenticated
  using (public.is_platform_admin() or user_id = (select auth.uid()));

-- time_off_requests: staff see/submit own; admins see all + decide
drop policy if exists time_off_select on public.time_off_requests;
create policy time_off_select on public.time_off_requests
  for select to authenticated
  using (
    public.is_platform_admin()
    or user_id = (select auth.uid())
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'admin')
    )
  );

drop policy if exists time_off_insert on public.time_off_requests;
create policy time_off_insert on public.time_off_requests
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (
      user_id = (select auth.uid())
      and facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'write')
      and status = 'pending'
      and decided_by is null
      and decided_at is null
    )
  );

-- UPDATE via RPCs only — no direct update policy. RPC functions are SECURITY
-- DEFINER and do their own auth checks.

-- shift_swap_requests: requester + target + admins see; requester creates; all transitions via RPC
drop policy if exists shift_swap_select on public.shift_swap_requests;
create policy shift_swap_select on public.shift_swap_requests
  for select to authenticated
  using (
    public.is_platform_admin()
    or requester_user_id = (select auth.uid())
    or target_user_id = (select auth.uid())
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'admin')
    )
  );

drop policy if exists shift_swap_insert on public.shift_swap_requests;
create policy shift_swap_insert on public.shift_swap_requests
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (
      requester_user_id = (select auth.uid())
      and facility_id = public.current_facility_id()
      and public.has_module_access('scheduling', 'write')
      and status = 'pending_target'
    )
  );

-- UPDATE via RPCs only.

comment on table public.schedules is 'Weekly schedules. week_start_date always Sunday. Status draft → published (→ archived).';
comment on table public.shifts is 'Shifts within a schedule. Position is a facility_resources row with resource_type=shift_position (enforced by trigger in migration 2).';
comment on table public.shift_assignments is 'Who works a shift. Overlap-block trigger in migration 2 prevents same user on overlapping shifts (±24h, excludes archived schedules).';
comment on table public.availability_templates is 'Recurring weekly availability default per user. Multiple blocks per day allowed.';
comment on table public.availability_overrides is 'Per-week, per-day override on top of the template. Additive: days without an override fall back to template.';
comment on table public.time_off_requests is 'Staff-submitted time off. Decided via rpc_time_off_decide / rpc_time_off_withdraw. schedule_adjusted_before_withdraw flags post-approval withdrawals where the manager had already rearranged the schedule.';
comment on table public.shift_swap_requests is 'Staff-proposed shift swaps. Flow branches on facilities.settings.scheduling.swap_approval_mode: manager_approval (default) adds a pending_manager step; free skips it.';
