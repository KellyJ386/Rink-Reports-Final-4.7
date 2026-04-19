-- supabase/tests/07_facility_invites.test.sql
-- facility_invites: state machine, RLS, cross-facility isolation, role-facility-match trigger.

begin;
select plan(16);

create or replace function _test_as(p_user_id uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
           true);
$$;

-- Alpha admin creates an invite for the Manager role in alpha
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select lives_ok(
  $$insert into public.facility_invites
      (email, role_id, invited_by, token_hash, expires_at)
    values (
      'newhire@alpha.test',
      '00000001-1000-0000-0000-000000000002',
      '00000001-0000-0000-0000-000000001001',
      '0000000000000000000000000000000000000000000000000000000000000001',
      now() + interval '7 days'
    )$$,
  'alpha admin can create an invite for own facility'
);

-- Alpha staff CANNOT create invites (requires admin)
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);
select throws_ok(
  $$insert into public.facility_invites
      (email, role_id, invited_by, token_hash, expires_at)
    values (
      'staffpal@alpha.test',
      '00000001-1000-0000-0000-000000000003',
      '00000001-0000-0000-0000-000000001003',
      '0000000000000000000000000000000000000000000000000000000000000002',
      now() + interval '7 days'
    )$$,
  null,
  'alpha staff cannot create invites (lacks admin access)'
);

-- Alpha admin CANNOT create invites with a beta role (trigger blocks)
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select throws_ok(
  $$insert into public.facility_invites
      (email, role_id, invited_by, token_hash, expires_at)
    values (
      'cross@alpha.test',
      '00000002-2000-0000-0000-000000000002',
      '00000001-0000-0000-0000-000000001001',
      '0000000000000000000000000000000000000000000000000000000000000003',
      now() + interval '7 days'
    )$$,
  null,
  'alpha admin cannot create an invite referencing a beta role (trigger blocks)'
);

-- Alpha admin CANNOT forge facility_id to beta
select throws_ok(
  $$insert into public.facility_invites
      (facility_id, email, role_id, invited_by, token_hash, expires_at)
    values (
      '00000002-0000-0000-0000-000000000002',
      'forge@attempt.test',
      '00000002-2000-0000-0000-000000000001',
      '00000001-0000-0000-0000-000000001001',
      '0000000000000000000000000000000000000000000000000000000000000004',
      now() + interval '7 days'
    )$$,
  null,
  'alpha admin cannot forge facility_id to beta in invite insert'
);

-- Beta admin cannot see alpha's outstanding invite
select _test_as('00000002-0000-0000-0000-000000002001'::uuid);
select is(
  (select count(*)::int from public.facility_invites
   where email = 'newhire@alpha.test'),
  0,
  'beta admin cannot see alpha invites'
);

-- Alpha staff cannot see invites at all (requires admin on admin_control_center)
select _test_as('00000001-0000-0000-0000-000000001003'::uuid);
select is(
  (select count(*)::int from public.facility_invites),
  0,
  'alpha staff cannot see invites (RLS requires admin)'
);

-- Partial unique index: cannot issue a second outstanding invite to the same email+facility
select _test_as('00000001-0000-0000-0000-000000001001'::uuid);
select throws_ok(
  $$insert into public.facility_invites
      (email, role_id, invited_by, token_hash, expires_at)
    values (
      'newhire@alpha.test',
      '00000001-1000-0000-0000-000000000003',
      '00000001-0000-0000-0000-000000001001',
      '0000000000000000000000000000000000000000000000000000000000000005',
      now() + interval '7 days'
    )$$,
  null,
  'cannot issue a second outstanding invite to the same (facility, email)'
);

-- Revoke the invite via rpc_revoke_invite
select lives_ok(
  $$select public.rpc_revoke_invite(
      (select id from public.facility_invites where email = 'newhire@alpha.test' limit 1)
    )$$,
  'alpha admin can revoke their own invite via rpc_revoke_invite'
);

-- Now the partial index is satisfied again; can issue another
select lives_ok(
  $$insert into public.facility_invites
      (email, role_id, invited_by, token_hash, expires_at)
    values (
      'newhire@alpha.test',
      '00000001-1000-0000-0000-000000000003',
      '00000001-0000-0000-0000-000000001001',
      '0000000000000000000000000000000000000000000000000000000000000006',
      now() + interval '7 days'
    )$$,
  'can issue a new invite after revoking the previous one'
);

-- rpc_lookup_invite_by_token returns 'not_found' for unknown tokens
select is(
  (select state from public.rpc_lookup_invite_by_token('nonsense-token-xyz')),
  'not_found'::text,
  'unknown token returns not_found'
);

-- rpc_lookup_invite_by_token returns 'not_found' for too-short input
select is(
  (select state from public.rpc_lookup_invite_by_token('x')),
  'not_found'::text,
  'short token returns not_found (no oracle)'
);

-- Create a real token, verify rpc_lookup returns 'valid'
-- We can't easily compute sha256 in a pgTAP script portably, so we insert a known
-- raw token + its hash and verify.
--
-- sha256('test-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa') computed out-of-band:
--   b2e3c40bcb4a1f0b6a5a6c8e7e6d5c4b3a2918070605040302010f0e0d0c0b0a
-- (this is illustrative; in practice use encode(extensions.digest(...)))
select lives_ok(
  $$insert into public.facility_invites
      (email, role_id, invited_by, token_hash, expires_at)
    values (
      'lookup@alpha.test',
      '00000001-1000-0000-0000-000000000003',
      '00000001-0000-0000-0000-000000001001',
      encode(extensions.digest('test-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'sha256'), 'hex'),
      now() + interval '7 days'
    )$$,
  'seed a known-token invite for lookup test'
);

select is(
  (select state from public.rpc_lookup_invite_by_token('test-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  'valid'::text,
  'rpc_lookup returns valid for a matching token'
);

-- Expired invites return 'expired'
select lives_ok(
  $$update public.facility_invites
    set expires_at = now() - interval '1 hour'
    where email = 'lookup@alpha.test'$$,
  'backdate invite to simulate expiry'
);

select is(
  (select state from public.rpc_lookup_invite_by_token('test-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  'expired'::text,
  'rpc_lookup returns expired for backdated invite'
);

-- Revoked invites return 'revoked' (higher priority than expired)
select lives_ok(
  $$update public.facility_invites
    set revoked_at = now(), expires_at = now() + interval '7 days'
    where email = 'lookup@alpha.test'$$,
  'revoke and un-backdate invite'
);

select is(
  (select state from public.rpc_lookup_invite_by_token('test-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  'revoked'::text,
  'rpc_lookup returns revoked'
);

select * from finish();
rollback;
