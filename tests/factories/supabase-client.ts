/**
 * Shared Supabase clients for integration + E2E tests.
 *
 * `anonClient()` — the same shape as the browser sees. Auth is performed via
 * `signInWithPassword` using seeded test credentials.
 *
 * `serviceClient()` — service role; bypasses RLS. Only used by factories that
 * need to clean up across tenants.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}. Did you export Supabase locals?`)
  return v
}

export function anonClient(): SupabaseClient {
  return createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { persistSession: false } },
  )
}

export function serviceClient(): SupabaseClient {
  return createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  )
}

// Seeded users from supabase/seed.sql — deterministic UUIDs + known passwords.
export const SEEDED_USERS = {
  platformAdmin: {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'platform@rinkreports.test',
    password: 'platform-dev-only',
  },
  alphaAdmin: {
    id: '00000001-0000-0000-0000-000000001001',
    email: 'admin-alpha@rinkreports.test',
    password: 'alpha-dev-only',
    facility_id: '00000001-0000-0000-0000-000000000001',
  },
  alphaManager: {
    id: '00000001-0000-0000-0000-000000001002',
    email: 'manager-alpha@rinkreports.test',
    password: 'alpha-dev-only',
    facility_id: '00000001-0000-0000-0000-000000000001',
  },
  alphaStaff: {
    id: '00000001-0000-0000-0000-000000001003',
    email: 'staff-alpha@rinkreports.test',
    password: 'alpha-dev-only',
    facility_id: '00000001-0000-0000-0000-000000000001',
  },
  betaAdmin: {
    id: '00000002-0000-0000-0000-000000002001',
    email: 'admin-beta@rinkreports.test',
    password: 'beta-dev-only',
    facility_id: '00000002-0000-0000-0000-000000000002',
  },
  betaStaff: {
    id: '00000002-0000-0000-0000-000000002003',
    email: 'staff-beta@rinkreports.test',
    password: 'beta-dev-only',
    facility_id: '00000002-0000-0000-0000-000000000002',
  },
} as const

export async function signIn(
  client: SupabaseClient,
  user: { email: string; password: string },
): Promise<void> {
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  if (error) throw new Error(`signIn failed for ${user.email}: ${error.message}`)
}
