-- 20260421000002_form_schemas.sql
-- Per-facility, per-module form definitions. Draft + published state in a single row.
--
-- Lifecycle (see also rpc_publish_form_schema / rpc_discard_form_schema_draft):
--   1. enableModule inserts row with schema_definition = default_schema_definition,
--      draft_definition = null, version = 1, is_published = true.
--   2. Admin edits in /admin/forms/<module>/<form_type> — draft_definition set,
--      schema_definition untouched.
--   3. Publish: snapshot current (schema_definition, version) to form_schema_history;
--      swap schema_definition ← draft_definition; version += 1; null draft_definition.
--   4. Discard: null draft_definition.
--
-- Every row carries a $schema marker in schema_definition identifying the format
-- version ('rink-form-schema/v1'). Meta-schema validation in TypeScript rejects any
-- document that doesn't match the expected shape at publish time.

create table if not exists public.form_schemas (
  id                  uuid primary key default gen_random_uuid(),
  facility_id         uuid not null default public.current_facility_id()
                        references public.facilities(id) on delete cascade,
  module_slug         text not null references public.modules(slug) on delete restrict,
  form_type           text,
  schema_definition   jsonb not null,
  draft_definition    jsonb,
  version             integer not null default 1,
  is_published        boolean not null default true,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.users(id) on delete set null,

  constraint form_schemas_form_type_format_chk
    check (form_type is null or form_type ~ '^[a-z][a-z0-9_]{0,63}$')
);

-- Partial unique indexes: nullable form_type requires splitting.
create unique index if not exists form_schemas_facility_module_ft_key
  on public.form_schemas (facility_id, module_slug, form_type)
  where form_type is not null;

create unique index if not exists form_schemas_facility_module_null_ft_key
  on public.form_schemas (facility_id, module_slug)
  where form_type is null;

create index if not exists form_schemas_facility_idx
  on public.form_schemas (facility_id);

drop trigger if exists form_schemas_touch_updated_at on public.form_schemas;
create trigger form_schemas_touch_updated_at
  before update on public.form_schemas
  for each row execute function public.tg_touch_updated_at();

alter table public.form_schemas enable row level security;

-- RLS:
--   SELECT — everyone in facility (forms render for every user)
--   INSERT — platform admin or facility admin (normally via enableModule or future admin UI)
--   UPDATE — facility admin (drafts, publishes via RPC). schema_definition / version
--            changes happen only via rpc_publish_form_schema; we still need a policy
--            that allows the RPC (running as SECURITY DEFINER sidesteps RLS anyway but
--            we keep policies tight for any direct UPDATE path).
--   DELETE — platform admin only (disabling a module doesn't delete the row; just
--            flips facility_modules.is_enabled).

drop policy if exists form_schemas_select on public.form_schemas;
create policy form_schemas_select on public.form_schemas
  for select to authenticated
  using (
    public.is_platform_admin()
    or facility_id = public.current_facility_id()
  );

drop policy if exists form_schemas_insert on public.form_schemas;
create policy form_schemas_insert on public.form_schemas
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'admin'))
  );

drop policy if exists form_schemas_update on public.form_schemas;
create policy form_schemas_update on public.form_schemas
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

drop policy if exists form_schemas_delete on public.form_schemas;
create policy form_schemas_delete on public.form_schemas
  for delete to authenticated
  using (public.is_platform_admin());

-- form_schema_history — append-only snapshots

create table if not exists public.form_schema_history (
  id                  uuid primary key default gen_random_uuid(),
  facility_id         uuid not null references public.facilities(id) on delete cascade,
  module_slug         text not null references public.modules(slug) on delete restrict,
  form_type           text,
  version             integer not null,
  schema_definition   jsonb not null,
  published_by        uuid references public.users(id) on delete set null,
  published_at        timestamptz not null default now()
);

create unique index if not exists form_schema_history_ft_version_key
  on public.form_schema_history (facility_id, module_slug, form_type, version)
  where form_type is not null;

create unique index if not exists form_schema_history_null_ft_version_key
  on public.form_schema_history (facility_id, module_slug, version)
  where form_type is null;

create index if not exists form_schema_history_facility_idx
  on public.form_schema_history (facility_id, module_slug, form_type, version desc);

alter table public.form_schema_history enable row level security;

drop policy if exists form_schema_history_select on public.form_schema_history;
create policy form_schema_history_select on public.form_schema_history
  for select to authenticated
  using (
    public.is_platform_admin()
    or facility_id = public.current_facility_id()
  );

-- INSERT via SECURITY DEFINER publish RPC only (the RPC bypasses RLS).
-- No policy grants INSERT to authenticated — block any attempt to write directly.

-- UPDATE/DELETE blocked by trigger (append-only).
create or replace function public.tg_form_schema_history_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'form_schema_history is append-only. UPDATE and DELETE are not permitted.'
    using errcode = '42501';
end;
$$;

drop trigger if exists form_schema_history_block_update on public.form_schema_history;
create trigger form_schema_history_block_update
  before update on public.form_schema_history
  for each row execute function public.tg_form_schema_history_append_only();

drop trigger if exists form_schema_history_block_delete on public.form_schema_history;
create trigger form_schema_history_block_delete
  before delete on public.form_schema_history
  for each row execute function public.tg_form_schema_history_append_only();

comment on table public.form_schemas is
  'Per-facility form definitions. One row per (facility, module_slug, form_type). Drafts live in draft_definition; publish swaps + snapshots to form_schema_history.';
comment on column public.form_schemas.schema_definition is
  'Currently-published schema JSON. Includes $schema marker (rink-form-schema/v1).';
comment on column public.form_schemas.draft_definition is
  'Admin''s in-progress edit. Null means no draft. Publish moves this into schema_definition and bumps version.';
comment on table public.form_schema_history is
  'Append-only snapshot of every published schema version. FormDetail reads here by pinned form_schema_version to render historical submissions correctly.';
