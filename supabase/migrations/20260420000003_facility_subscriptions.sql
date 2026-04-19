-- 20260420000003_facility_subscriptions.sql
-- Skeleton subscription table. Agent 1b ships the schema and the trialing-row creation
-- in createFacilityWithFirstAdmin(). Agent 7 wires Stripe webhooks, billing portal,
-- and gating middleware on top — nothing Stripe-specific lives in this migration.
--
-- Invariants in Phase 1 (pre-Stripe):
--   * Every facility (non-platform) has exactly one subscription row.
--   * status = 'trialing' at creation, trial_end = now() + 30 days.
--   * No gating middleware yet — writes are unrestricted for trial facilities.
--   * stripe_* columns are nullable until Agent 7 lands.

create table if not exists public.facility_subscriptions (
  facility_id             uuid primary key references public.facilities(id) on delete cascade,
  stripe_customer_id      text,
  stripe_subscription_id  text,
  status                  text not null
                          check (status in ('trialing', 'active', 'past_due', 'canceled')),
  plan_tier               text,
  trial_end               timestamptz,
  current_period_end      timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists facility_subscriptions_status_idx
  on public.facility_subscriptions (status);

create unique index if not exists facility_subscriptions_stripe_sub_key
  on public.facility_subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

drop trigger if exists facility_subscriptions_touch_updated_at on public.facility_subscriptions;
create trigger facility_subscriptions_touch_updated_at
  before update on public.facility_subscriptions
  for each row execute function public.tg_touch_updated_at();

alter table public.facility_subscriptions enable row level security;

-- RLS: SELECT by facility admins for their own facility; platform admins see all.
-- INSERT/UPDATE: service role only (bootstrap + Stripe webhooks). No user-level writes.
-- This keeps subscription state tamper-proof from the application.

drop policy if exists facility_subscriptions_select on public.facility_subscriptions;
create policy facility_subscriptions_select on public.facility_subscriptions
  for select to authenticated
  using (
    public.is_platform_admin()
    or (facility_id = public.current_facility_id()
        and public.has_module_access('admin_control_center', 'read'))
  );

-- No INSERT/UPDATE/DELETE policies for authenticated role — service role only.
-- (createFacilityWithFirstAdmin runs as service role. Stripe webhooks same.)

comment on table public.facility_subscriptions is
  'One row per facility, created at facility creation with status=trialing. Agent 7 extends with Stripe wiring.';
comment on column public.facility_subscriptions.status is
  'Subscription state. trialing → active (on payment) → past_due → canceled. Gating middleware lives in Agent 7.';
