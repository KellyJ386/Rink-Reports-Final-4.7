import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Enable a module for a facility. Flips facility_modules.is_enabled = true and seeds
 * form_schemas from module_default_schemas (once Agent 2 ships form_schemas).
 *
 * AuthZ (enforced in SQL): platform admin OR facility admin for the target facility.
 */
export async function enableModule(facilityId: string, moduleSlug: string): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase.rpc('rpc_enable_module', {
    p_facility_id: facilityId,
    p_module_slug: moduleSlug,
  })

  if (error) {
    throw new Error(`enableModule(${moduleSlug}): ${error.message}`)
  }
}
