-- 20260420000001_module_default_schemas.sql
-- Global default form_schemas per module, seeded in code by Agent 3 (form-engine modules)
-- and consumed by enableModule() when a facility enables a module.
--
-- Not tenant-scoped. Modules are global; defaults are global. Per-facility copies land
-- in form_schemas (Agent 2's table) when enableModule() runs.
--
-- Uniqueness: one default per (module_slug, form_type) AND one for (module_slug,
-- form_type IS NULL). Postgres disallows function expressions in PK definitions,
-- so we use a surrogate id PK + a unique expression index on
-- (module_slug, coalesce(form_type, '')) to collapse the NULL/text cases.

create table if not exists public.module_default_schemas (
  id                          uuid primary key default gen_random_uuid(),
  module_slug                 text not null references public.modules(slug) on delete cascade,
  form_type                   text,
  default_schema_definition   jsonb not null,
  updated_at                  timestamptz not null default now()
);

create unique index if not exists module_default_schemas_slug_type_key
  on public.module_default_schemas (module_slug, coalesce(form_type, ''));

drop trigger if exists module_default_schemas_touch_updated_at on public.module_default_schemas;
create trigger module_default_schemas_touch_updated_at
  before update on public.module_default_schemas
  for each row execute function public.tg_touch_updated_at();

alter table public.module_default_schemas enable row level security;

-- RLS: read-only for all authenticated users (so admin UIs can display defaults);
-- only platform admins write (Agent 3 seeds via service role in migrations).
drop policy if exists module_default_schemas_select on public.module_default_schemas;
create policy module_default_schemas_select on public.module_default_schemas
  for select to authenticated using (true);

drop policy if exists module_default_schemas_insert on public.module_default_schemas;
create policy module_default_schemas_insert on public.module_default_schemas
  for insert to authenticated
  with check (public.is_platform_admin());

drop policy if exists module_default_schemas_update on public.module_default_schemas;
create policy module_default_schemas_update on public.module_default_schemas
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists module_default_schemas_delete on public.module_default_schemas;
create policy module_default_schemas_delete on public.module_default_schemas
  for delete to authenticated
  using (public.is_platform_admin());

comment on table public.module_default_schemas is
  'Global default form_schemas per module. Seeded by Agent 3 (form-engine modules). Agent 2''s enableModule() copies rows from here into per-facility form_schemas on module enable.';
