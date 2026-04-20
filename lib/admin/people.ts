import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { forceLogoutUser as sharedForceLogout } from '@/lib/auth/force-logout'

/**
 * Server actions for People admin (users, roles, role assignments).
 * Invite server actions live in lib/invites/ (Agent 1b); re-exported below.
 */

export async function changeUserRole(
  userId: string,
  roleId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()

  // Replace any existing role assignments for this user with the single new role.
  // Simplifying assumption: every user has exactly one role in v1. If multi-role
  // becomes needed, expand this action.
  const { error: deleteError } = await supabase.from('user_roles').delete().eq('user_id', userId)
  if (deleteError) return { ok: false, error: deleteError.message }

  const {
    data: { user: actor },
  } = await supabase.auth.getUser()

  const { error: insertError } = await supabase
    .from('user_roles')
    .insert({ user_id: userId, role_id: roleId, assigned_by: actor?.id ?? null })
  if (insertError) return { ok: false, error: insertError.message }

  // Audit
  const { data: target } = await supabase
    .from('users')
    .select('facility_id')
    .eq('id', userId)
    .maybeSingle()

  await supabase.from('audit_log').insert({
    facility_id: target?.facility_id ?? null,
    actor_user_id: actor?.id ?? null,
    action: 'user.role_changed',
    entity_type: 'user',
    entity_id: userId,
    metadata: { new_role_id: roleId },
  })

  return { ok: true }
}

export async function deactivateUser(userId: string, reason?: string) {
  return sharedForceLogout({ user_id: userId, reason })
}

export async function reactivateUser(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('users').update({ active: true }).eq('id', userId)
  if (error) return { ok: false, error: error.message }

  const { data: target } = await supabase
    .from('users')
    .select('facility_id')
    .eq('id', userId)
    .maybeSingle()
  const {
    data: { user: actor },
  } = await supabase.auth.getUser()

  await supabase.from('audit_log').insert({
    facility_id: target?.facility_id ?? null,
    actor_user_id: actor?.id ?? null,
    action: 'user.reactivated',
    entity_type: 'user',
    entity_id: userId,
    metadata: {},
  })
  return { ok: true }
}

// Re-export the canonical force-logout for convenience
export { forceLogoutUser } from '@/lib/auth/force-logout'

// ----------------------------------------------------------------------------
// Roles + access matrix
// ----------------------------------------------------------------------------

export async function createRole({
  name,
  description,
}: {
  name: string
  description?: string
}): Promise<{ ok: true; role_id: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('roles')
    .insert({ name, description: description ?? null, is_system: false })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, role_id: data.id as string }
}

export async function updateRole(
  roleId: string,
  patch: { name?: string; description?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from('roles').update(patch).eq('id', roleId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function deleteRole(
  roleId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  // Check if any user is assigned
  const { count, error: countError } = await supabase
    .from('user_roles')
    .select('*', { count: 'exact', head: true })
    .eq('role_id', roleId)
  if (countError) return { ok: false, error: countError.message }
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `Cannot delete role: ${count} user(s) still assigned. Reassign them first.`,
    }
  }
  const { error } = await supabase.from('roles').delete().eq('id', roleId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function setRoleModuleAccess(
  roleId: string,
  moduleId: string,
  accessLevel: 'none' | 'read' | 'write' | 'admin',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('role_module_access')
    .upsert({ role_id: roleId, module_id: moduleId, access_level: accessLevel })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
