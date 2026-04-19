import 'server-only'

import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'

/**
 * Enforce that a module is enabled for the caller's current facility. Called at the
 * top of every /modules/<slug>/... route page. If the module is disabled (or the
 * user has no module row for it), returns a 404.
 *
 * Why route-level rather than middleware: this is one DB round trip per request to
 * /modules/*, avoided for everything else. Middleware would hit every request.
 *
 * Platform admins impersonating into a facility pass through this check like any
 * other user — impersonation scopes current_facility_id() so facility_modules reads
 * the right row.
 */
export async function requireModuleEnabled(moduleSlug: string): Promise<void> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('facility_modules')
    .select('is_enabled, modules!inner(slug)')
    .eq('modules.slug', moduleSlug)
    .maybeSingle()

  if (error) {
    console.error(`requireModuleEnabled(${moduleSlug}): query error`, error)
    notFound()
  }

  if (!data || !data.is_enabled) {
    notFound()
  }
}
