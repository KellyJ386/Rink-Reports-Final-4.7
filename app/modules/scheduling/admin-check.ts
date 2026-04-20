import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Manager-level access check for the Scheduling module. Maps to
 * has_module_access('scheduling','admin'). Staff hold 'write' and do NOT pass.
 * See SCHEDULING.md for the level → role mapping.
 */
export async function hasSchedulingAdminAccess(): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('has_module_access', {
    p_module_slug: 'scheduling',
    p_required_level: 'admin',
  })
  if (error) return false
  return Boolean(data)
}

export async function hasSchedulingWriteAccess(): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('has_module_access', {
    p_module_slug: 'scheduling',
    p_required_level: 'write',
  })
  if (error) return false
  return Boolean(data)
}
