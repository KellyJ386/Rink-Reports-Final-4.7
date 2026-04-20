-- 20260424000001_notifications.sql
-- Notifications + delivery tracking. Per-user feed; realtime channel scoped
-- user:{user_id}:notifications; email delivery is the TS layer's concern.
--
-- Inserts flow exclusively through publish_notification() — a SECURITY DEFINER
-- function that verifies the (user_id, facility_id) pair is consistent before
-- writing. No direct authenticated INSERT path.

create table if not exists public.notifications (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null references public.facilities(id) on delete cascade,
  user_id        uuid not null references public.users(id) on delete cascade,
  kind           text not null check (kind ~ '^[a-z][a-z0-9_.]*$'),
  payload        jsonb not null default '{}'::jsonb,
  read_at        timestamptz,
  email_sent_at  timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id)
  where read_at is null;

create index if not exists notifications_kind_created_idx
  on public.notifications (kind, created_at desc);

alter table public.notifications enable row level security;

-- SELECT own + platform admin escape hatch
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

-- UPDATE: own rows only; WITH CHECK prevents changing anything except read_at.
-- Postgres RLS doesn't enforce column-level checks directly, so we rely on a
-- BEFORE UPDATE trigger to lock non-read_at columns.
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.tg_notifications_only_read_at()
returns trigger
language plpgsql
as $$
begin
  if new.user_id        is distinct from old.user_id
     or new.facility_id is distinct from old.facility_id
     or new.kind        is distinct from old.kind
     or new.payload     is distinct from old.payload
     or new.created_at  is distinct from old.created_at
     or new.email_sent_at is distinct from old.email_sent_at then
    raise exception 'Only read_at may be updated on notifications by users'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_only_read_at on public.notifications;
create trigger notifications_only_read_at
  before update on public.notifications
  for each row execute function public.tg_notifications_only_read_at();

-- DELETE never for authenticated; platform admin escape hatch (via service role
-- in practice, but we keep the policy shape consistent)
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated
  using (public.is_platform_admin());

-- No INSERT policy for authenticated — all writes via publish_notification().
-- (Service role bypasses RLS entirely, so Agent 7's server wrapper still works.)

-- ----------------------------------------------------------------------------
-- publish_notification(target_user, kind, payload)
-- ----------------------------------------------------------------------------
-- Inserts a row for a single user. Verifies the user exists + resolves the
-- facility_id from users.facility_id (no forging). Callable by authenticated
-- users (server actions) and service role alike; RLS is bypassed by SECURITY
-- DEFINER so writes succeed regardless of the notification table's INSERT policy.

create or replace function public.publish_notification(
  p_user_id uuid,
  p_kind text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_facility_id uuid;
  v_id uuid;
begin
  select facility_id into v_facility_id from public.users where id = p_user_id;
  if v_facility_id is null then
    raise exception 'publish_notification: target user % has no facility', p_user_id
      using errcode = 'P0002';
  end if;

  insert into public.notifications (facility_id, user_id, kind, payload)
  values (v_facility_id, p_user_id, p_kind, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.publish_notification(uuid, text, jsonb) to authenticated;

comment on table public.notifications is
  'Per-user feed. Inserts via publish_notification() only. UPDATE limited to read_at via trigger.';
comment on function public.publish_notification(uuid, text, jsonb) is
  'Server-side notification insert. Resolves facility_id from users; rejects missing users. SECURITY DEFINER.';
