import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Returns true if the current user has admin access to the communications
 * module. Used to gate "+ New announcement", archive-view link, and the
 * receipts page.
 *
 * Platform admins also get true (RLS has_module_access already treats them as
 * super-admin).
 */
export async function hasCommunicationsAdminAccess(): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('has_module_access', {
    p_module_slug: 'communications',
    p_required_level: 'admin',
  })
  if (error) return false
  return Boolean(data)
}
