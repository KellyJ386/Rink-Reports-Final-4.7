-- 20260421000001_option_lists.sql
-- Shared dropdown option sources.
--
-- Two tables:
--   option_lists        — one row per (facility, slug) — named list of options
--   option_list_items   — the options themselves, with stable `key` + editable `label`
--
-- Stability rule: submissions store the key, not the label. Renaming a label never
-- rewrites history. A trigger enforces that key cannot be updated after insertion
-- (defense in depth; Agent 6's UI will also prevent edits).

create table if not exists public.option_lists (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null default public.current_facility_id()
                    references public.facilities(id) on delete cascade,
  slug            text not null,
  name            text not null,
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint option_lists_slug_format_chk
    check (slug ~ '^[a-z][a-z0-9_]{0,63}$')
);

create unique index if not exists option_lists_facility_slug_key
  on public.option_lists (facility_id, slug);

drop trigger if exists option_lists_touch_updated_at on public.option_lists;
create trigger option_lists_touch_updated_at
  before update on public.option_lists
  for each row execute function public.tg_touch_updated_at();

alter table public.option_lists enable row level security;

-- RLS: read by anyone in the facility (forms need to resolve these); admin writes.

drop policy if exists option_lists_select on public.option_lists;
create policy option_lists_select on public.option_lists
  for select to authenticated
  using (
    public.is_platform_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists option_lists_insert on public.option_lists;
create policy option_lists_insert on public.option_lists
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  );

drop policy if exists option_lists_update on public.option_lists;
create policy option_lists_update on public.option_lists
  for update to authenticated
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

drop policy if exists option_lists_delete on public.option_lists;
create policy option_lists_delete on public.option_lists
  for delete to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  );

-- option_list_items

create table if not exists public.option_list_items (
  id              uuid primary key default gen_random_uuid(),
  option_list_id  uuid not null references public.option_lists(id) on delete cascade,
  key             text not null,
  label           text not null,
  sort_order      integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint option_list_items_key_format_chk
    check (key ~ '^[a-z0-9][a-z0-9_]{0,63}$'),
  constraint option_list_items_label_nonempty_chk
    check (length(label) > 0)
);

create unique index if not exists option_list_items_list_key
  on public.option_list_items (option_list_id, key);

create index if not exists option_list_items_list_sort_idx
  on public.option_list_items (option_list_id, is_active, sort_order);

drop trigger if exists option_list_items_touch_updated_at on public.option_list_items;
create trigger option_list_items_touch_updated_at
  before update on public.option_list_items
  for each row execute function public.tg_touch_updated_at();

-- Key immutability trigger. Defense in depth: Agent 6's UI will block this too, but
-- relying on UI alone would make the DB inconsistent with the invariant.
create or replace function public.tg_option_list_items_key_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.key is distinct from old.key then
    raise exception 'option_list_items.key is immutable once saved. Deactivate and create a new item instead (deactivation preserves history references).'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists option_list_items_key_immutable on public.option_list_items;
create trigger option_list_items_key_immutable
  before update of key on public.option_list_items
  for each row execute function public.tg_option_list_items_key_immutable();

alter table public.option_list_items enable row level security;

-- RLS follows the parent option_lists: read by facility, write by admin.
-- We join to option_lists to get facility_id.

drop policy if exists option_list_items_select on public.option_list_items;
create policy option_list_items_select on public.option_list_items
  for select to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1 from public.option_lists ol
      where ol.id = option_list_items.option_list_id
        and ol.facility_id = public.current_facility_id()
    )
  );

drop policy if exists option_list_items_insert on public.option_list_items;
create policy option_list_items_insert on public.option_list_items
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (
      public.has_module_access('admin_control_center', 'admin')
      and exists (
        select 1 from public.option_lists ol
        where ol.id = option_list_items.option_list_id
          and ol.facility_id = public.current_facility_id()
      )
    )
  );

drop policy if exists option_list_items_update on public.option_list_items;
create policy option_list_items_update on public.option_list_items
  for update to authenticated
  using (
    public.is_platform_admin()
    or (
      public.has_module_access('admin_control_center', 'admin')
      and exists (
        select 1 from public.option_lists ol
        where ol.id = option_list_items.option_list_id
          and ol.facility_id = public.current_facility_id()
      )
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.has_module_access('admin_control_center', 'admin')
      and exists (
        select 1 from public.option_lists ol
        where ol.id = option_list_items.option_list_id
          and ol.facility_id = public.current_facility_id()
      )
    )
  );

drop policy if exists option_list_items_delete on public.option_list_items;
create policy option_list_items_delete on public.option_list_items
  for delete to authenticated
  using (
    public.is_platform_admin()
    or (
      public.has_module_access('admin_control_center', 'admin')
      and exists (
        select 1 from public.option_lists ol
        where ol.id = option_list_items.option_list_id
          and ol.facility_id = public.current_facility_id()
      )
    )
  );

comment on table public.option_lists is
  'Named, per-facility dropdown option source. Referenced by form_schemas via { from_option_list: slug }.';
comment on table public.option_list_items is
  'Individual options. key is immutable (trigger-enforced); label is editable. Submissions store key + snapshotted label so renames do not rewrite history.';
