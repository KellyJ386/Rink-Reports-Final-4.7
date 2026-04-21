-- 20260425000001_communications.sql
-- Bulletin-board announcements + per-user read/ack tracking for the
-- Communications module.
--
-- Two tables:
--   announcements       — one row per facility announcement
--   announcement_reads  — one row per (announcement, user) pair; tracks read_at
--                         and acknowledged_at
--
-- Writes to announcements go through server actions. No authenticated INSERT on
-- announcement_reads beyond auth.uid() = user_id — users stamp their own reads.

-- ============================================================================
-- announcements
-- ============================================================================

create table if not exists public.announcements (
  id                      uuid primary key default gen_random_uuid(),
  facility_id             uuid not null default public.current_facility_id()
                            references public.facilities(id) on delete cascade,
  author_user_id          uuid not null references public.users(id) on delete restrict,
  title                   text not null check (length(trim(title)) > 0),
  body                    text not null check (length(trim(body)) > 0),
  priority                text not null default 'normal'
                            check (priority in ('normal', 'important', 'urgent')),
  target_audience         text not null default 'all_staff'
                            check (target_audience in ('all_staff', 'specific_roles')),
  target_role_ids         uuid[],
  requires_acknowledgment boolean not null default false,
  posted_at               timestamptz not null default now(),
  expires_at              timestamptz,
  is_archived             boolean not null default false,
  archived_by             uuid references public.users(id) on delete set null,
  archived_at             timestamptz,
  idempotency_key         text,
  created_at              timestamptz not null default now(),
  constraint announcements_specific_roles_check
    check (
      target_audience <> 'specific_roles'
      or (target_role_ids is not null and array_length(target_role_ids, 1) > 0)
    )
);

create index if not exists announcements_facility_posted_idx
  on public.announcements (facility_id, posted_at desc);

create index if not exists announcements_facility_active_idx
  on public.announcements (facility_id)
  where is_archived = false;

create unique index if not exists announcements_idempotency_key
  on public.announcements (facility_id, idempotency_key)
  where idempotency_key is not null;

alter table public.announcements enable row level security;

-- SELECT: platform admin OR (own facility AND (admin role OR author OR targeted staff))
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
  for select to authenticated
  using (
    public.is_platform_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        public.has_module_access('communications', 'admin')
        or author_user_id = auth.uid()
        or (
          public.has_module_access('communications', 'read')
          and (
            target_audience = 'all_staff'
            or target_role_ids && (
              select array_agg(role_id)
              from public.user_roles
              where user_id = auth.uid()
            )
          )
        )
      )
    )
  );

-- INSERT: write access; facility_id defaults to current_facility_id()
drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (
      facility_id = public.current_facility_id()
      and public.has_module_access('communications', 'write')
    )
  );

-- UPDATE: author or admin within own facility
drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements
  for update to authenticated
  using (
    public.is_platform_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        author_user_id = auth.uid()
        or public.has_module_access('communications', 'admin')
      )
    )
  )
  with check (
    public.is_platform_admin()
    or (
      facility_id = public.current_facility_id()
      and (
        author_user_id = auth.uid()
        or public.has_module_access('communications', 'admin')
      )
    )
  );

-- DELETE: not permitted for authenticated (no policy = deny)

-- Trigger: lock immutable columns; server actions enforce edit-if-no-reads logic
create or replace function public.tg_announcements_immutable_cols()
returns trigger
language plpgsql
as $$
begin
  if new.id            is distinct from old.id
     or new.facility_id      is distinct from old.facility_id
     or new.author_user_id   is distinct from old.author_user_id
     or new.posted_at        is distinct from old.posted_at
     or new.created_at       is distinct from old.created_at then
    raise exception 'announcements: id, facility_id, author_user_id, posted_at, created_at are immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists announcements_immutable_cols on public.announcements;
create trigger announcements_immutable_cols
  before update on public.announcements
  for each row execute function public.tg_announcements_immutable_cols();

comment on table public.announcements is
  'Facility bulletin-board posts. Audience-targeted. Acknowledgment-tracked via announcement_reads.';
comment on column public.announcements.target_role_ids is
  'Non-null when target_audience = specific_roles. Overlap with user_roles determines visibility.';

-- ============================================================================
-- announcement_reads
-- ============================================================================

create table if not exists public.announcement_reads (
  id               uuid primary key default gen_random_uuid(),
  announcement_id  uuid not null references public.announcements(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  read_at          timestamptz not null default now(),
  acknowledged_at  timestamptz,
  unique (announcement_id, user_id)
);

create index if not exists announcement_reads_announcement_user_idx
  on public.announcement_reads (announcement_id, user_id);

create index if not exists announcement_reads_user_idx
  on public.announcement_reads (user_id, announcement_id);

alter table public.announcement_reads enable row level security;

-- SELECT: own rows, platform admin, or author/admin of the parent announcement
drop policy if exists announcement_reads_select on public.announcement_reads;
create policy announcement_reads_select on public.announcement_reads
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_platform_admin()
    or exists (
      select 1 from public.announcements a
      where a.id = announcement_id
        and (
          a.author_user_id = auth.uid()
          or public.has_module_access('communications', 'admin')
        )
    )
  );

-- INSERT: own rows only; announcement must be readable (RLS on announcements handles that)
drop policy if exists announcement_reads_insert on public.announcement_reads;
create policy announcement_reads_insert on public.announcement_reads
  for insert to authenticated
  with check (user_id = auth.uid());

-- UPDATE: own rows only; trigger restricts to acknowledged_at
drop policy if exists announcement_reads_update on public.announcement_reads;
create policy announcement_reads_update on public.announcement_reads
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Trigger: only acknowledged_at is mutable
create or replace function public.tg_announcement_reads_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.user_id          is distinct from old.user_id
     or new.announcement_id is distinct from old.announcement_id
     or new.read_at          is distinct from old.read_at then
    raise exception 'announcement_reads: only acknowledged_at may be updated'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists announcement_reads_immutable on public.announcement_reads;
create trigger announcement_reads_immutable
  before update on public.announcement_reads
  for each row execute function public.tg_announcement_reads_immutable();

comment on table public.announcement_reads is
  'Per-user read + ack tracking for announcements. INSERT on first open; UPDATE only sets acknowledged_at.';
