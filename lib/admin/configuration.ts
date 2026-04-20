import 'server-only'

import { enableModule } from '@/lib/facility/enable-module'
import { createClient } from '@/lib/supabase/server'

/**
 * Admin server actions for Configuration (Modules + Resources).
 * Admin Control Center itself is protected — cannot be disabled.
 */

const PROTECTED_MODULES = new Set(['admin_control_center'])

export async function setFacilityModuleEnabled(
  moduleSlug: string,
  isEnabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isEnabled && PROTECTED_MODULES.has(moduleSlug)) {
    return { ok: false, error: `Module "${moduleSlug}" cannot be disabled — it is protected.` }
  }

  const supabase = await createClient()

  if (isEnabled) {
    // enableModule is the canonical path — also seeds form_schemas from defaults
    try {
      await enableModule(
        (await getCurrentFacilityId(supabase)) ?? '',
        moduleSlug,
      )
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // Disable: flip is_enabled=false; audit
  const { data: module } = await supabase
    .from('modules')
    .select('id')
    .eq('slug', moduleSlug)
    .maybeSingle()
  if (!module) return { ok: false, error: `Unknown module ${moduleSlug}` }

  const facilityId = await getCurrentFacilityId(supabase)
  if (!facilityId) return { ok: false, error: 'No current facility' }

  const { error } = await supabase
    .from('facility_modules')
    .update({ is_enabled: false })
    .eq('facility_id', facilityId)
    .eq('module_id', module.id)
  if (error) return { ok: false, error: error.message }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  await supabase.from('audit_log').insert({
    facility_id: facilityId,
    actor_user_id: user?.id ?? null,
    action: 'module.disabled',
    entity_type: 'module',
    metadata: { module_slug: moduleSlug },
  })

  return { ok: true }
}

// ----------------------------------------------------------------------------
// Resources
// ----------------------------------------------------------------------------

export type CreateResourceInput = {
  resource_type: string
  name: string
  sort_order?: number
}

export async function createFacilityResource(
  input: CreateResourceInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('facility_resources')
    .insert({
      resource_type: input.resource_type,
      name: input.name,
      sort_order: input.sort_order ?? 0,
      is_active: true,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, id: data.id as string }
}

export async function updateFacilityResource(
  id: string,
  patch: { name?: string; sort_order?: number; is_active?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('facility_resources').update(patch).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Resource deletion is NOT supported in v1 (see ADMIN.md "Soft-delete is the model").
 * Use `updateFacilityResource(id, { is_active: false })` to deactivate instead. This
 * function exists to make the intent explicit and return a consistent error.
 */
export async function deleteFacilityResource(
  _id: string,
): Promise<{ ok: false; error: string }> {
  return {
    ok: false,
    error:
      'Resources cannot be deleted. Set is_active = false to retire; history references are preserved. ' +
      'If you truly need to purge, a platform admin can do it via SQL.',
  }
}

// ---- helpers ----

async function getCurrentFacilityId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const { data } = await supabase.rpc('current_facility_id')
  return (data as string | null) ?? null
}
