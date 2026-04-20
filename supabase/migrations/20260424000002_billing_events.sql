-- 20260424000002_billing_events.sql
-- Append-only log of every Stripe webhook event. Idempotent via stripe_event_id
-- unique constraint — replays are safe.
--
-- facility_subscriptions already exists (Agent 1b); Agent 7 just writes to it from
-- the webhook handler. No schema changes there.

create table if not exists public.billing_events (
  id                uuid primary key default gen_random_uuid(),
  stripe_event_id   text not null,
  event_type        text not null,
  payload           jsonb not null,
  processed_at      timestamptz,
  error_if_any      text,
  created_at        timestamptz not null default now()
);

create unique index if not exists billing_events_stripe_event_id_key
  on public.billing_events (stripe_event_id);

create index if not exists billing_events_unprocessed_idx
  on public.billing_events (created_at)
  where processed_at is null;

create index if not exists billing_events_errors_idx
  on public.billing_events (created_at desc)
  where error_if_any is not null and processed_at is null;

alter table public.billing_events enable row level security;

-- SELECT: platform admins only (facility admins see their subscription state on the
-- facility_subscriptions row; they don't need raw webhook events)
drop policy if exists billing_events_select on public.billing_events;
create policy billing_events_select on public.billing_events
  for select to authenticated
  using (public.is_platform_admin());

-- INSERT/UPDATE/DELETE: service role only (the webhook handler uses it; no policy
-- gives authenticated users write access).

-- Append-only trigger blocks UPDATE / DELETE even via service role by accident.
-- We DO need UPDATE to set processed_at / error_if_any — so we use a column-level
-- guard: only these two columns may change.
create or replace function public.tg_billing_events_update_guard()
returns trigger
language plpgsql
as $$
begin
  if new.stripe_event_id  is distinct from old.stripe_event_id
     or new.event_type    is distinct from old.event_type
     or new.payload       is distinct from old.payload
     or new.created_at    is distinct from old.created_at then
    raise exception 'billing_events: only processed_at and error_if_any are mutable after insert'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_events_update_guard on public.billing_events;
create trigger billing_events_update_guard
  before update on public.billing_events
  for each row execute function public.tg_billing_events_update_guard();

create or replace function public.tg_billing_events_no_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'billing_events is append-only; rows cannot be deleted'
    using errcode = '42501';
end;
$$;

drop trigger if exists billing_events_no_delete on public.billing_events;
create trigger billing_events_no_delete
  before delete on public.billing_events
  for each row execute function public.tg_billing_events_no_delete();

comment on table public.billing_events is
  'Append-only Stripe webhook log. Idempotency via unique stripe_event_id. Only processed_at / error_if_any mutable after insert.';
