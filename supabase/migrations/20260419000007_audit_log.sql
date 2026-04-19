-- 20260419000007_audit_log.sql
-- Every mutation records who/what/when/which facility.
--
-- Design notes:
--   * facility_id is nullable for platform-only events (e.g., a platform admin creates
--     a new facility — the event happens "in" the newly-created facility, but the
--     action predates that row existing cleanly, so we allow null and rely on
--     actor_user_id + action + metadata to reconstruct).
--   * actor_impersonator_id captures the platform admin when impersonation is active.
--     Agent 7's platform admin shell sets this on every audit write during impersonation.
--   * No UPDATE, no DELETE allowed — append-only.

create table if not exists public.audit_log (
  id                       uuid primary key default gen_random_uuid(),
  facility_id              uuid references public.facilities(id) on delete set null,
  actor_user_id            uuid references public.users(id) on delete set null,
  actor_impersonator_id    uuid references public.users(id) on delete set null,
  action                   text not null,
  entity_type              text,
  entity_id                uuid,
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now()
);

create index if not exists audit_log_facility_created_idx
  on public.audit_log (facility_id, created_at desc);

create index if not exists audit_log_actor_idx
  on public.audit_log (actor_user_id, created_at desc);

create index if not exists audit_log_action_idx
  on public.audit_log (action, created_at desc);

alter table public.audit_log enable row level security;

-- Block UPDATE and DELETE at the DB level. Append-only.
create or replace function public.tg_audit_log_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only. UPDATE and DELETE are not permitted.'
    using errcode = '42501';
end;
$$;

drop trigger if exists audit_log_block_update on public.audit_log;
create trigger audit_log_block_update
  before update on public.audit_log
  for each row execute function public.tg_audit_log_append_only();

drop trigger if exists audit_log_block_delete on public.audit_log;
create trigger audit_log_block_delete
  before delete on public.audit_log
  for each row execute function public.tg_audit_log_append_only();

comment on table public.audit_log is
  'Append-only audit trail. Every mutation across the product writes here.';
comment on column public.audit_log.actor_impersonator_id is
  'Platform admin user id when the event happened during an impersonation session; null otherwise.';
