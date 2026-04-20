import 'server-only'

import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

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
