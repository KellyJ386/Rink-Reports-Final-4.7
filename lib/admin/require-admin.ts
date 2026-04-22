import 'server-only'

import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * Gate for every /admin/* route. Verifies:
 *   1. Module `admin_control_center` is enabled for the current facility (via
 *      facility_modules.is_enabled — which is always true in practice because
 *      enableModule blocks disabling admin_control_center)
 *   2. Caller has `admin` access on `admin_control_center`
 *
 * Platform admins with an impersonation cookie pass because current_facility_id()
 * already accounts for impersonation, and is_platform_admin() ORs in on RLS.
 *
 * Failure: 404 (do NOT redirect or show a "forbidden" page — hiding the admin
 * surface from non-admins makes enumeration harder).
 *
 * For server actions that need a structured error shape instead of a 404
 * redirect — use `requireAdmin` below.
 */
export async function requireAdminControlCenterAdmin(): Promise<void> {
  const supabase = await createClient()

  // has_module_access is a SECURITY DEFINER DB function; we call it via RPC.
  const { data: hasAccess, error } = await supabase.rpc('has_module_access', {
    p_module_slug: 'admin_control_center',
    p_required_level: 'admin',
  })

  if (error) {
    console.error('requireAdminControlCenterAdmin: RPC error', error)
    notFound()
  }

  if (!hasAccess) notFound()
}

export type AdminGateResult = { ok: true } | { ok: false; error: string }

/**
 * Server-action-level admin gate. Same underlying check as
 * `requireAdminControlCenterAdmin` above — `has_module_access('admin_control_center',
 * 'admin')` — but returns a result union instead of calling `notFound()`.
 *
 * Use from server actions (`saveDraft`, `publishDraft`, option-list mutators,
 * etc.) where the failure mode is a structured `{ ok: false, error }` returned
 * to the client UI for toast display. Use `requireAdminControlCenterAdmin` for
 * Next.js route segments where a 404 is the right UX.
 *
 * Consolidated from per-file copies in `lib/forms/editor.ts` (Phase 2 Seam 1)
 * and `lib/admin/option-lists.ts` (Seam 2) — each shipped its own local
 * version to keep the seams merge-order-independent. This is the single
 * source of truth going forward.
 *
 * Pass an existing Supabase client when you already have one in scope
 * (avoids a double `createClient` round-trip per call); omit for a one-shot.
 *
 * Error message is intentionally generic — callers add action-specific
 * context upstream rather than having the gate claim what action was
 * attempted.
 */
export async function requireAdmin(supabase?: Supabase): Promise<AdminGateResult> {
  const client = supabase ?? (await createClient())
  const { data, error } = await client.rpc('has_module_access', {
    p_module_slug: 'admin_control_center',
    p_required_level: 'admin',
  })
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Admin access required' }
  return { ok: true }
}
