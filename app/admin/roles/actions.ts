'use server'

import { createRole, deleteRole, setRoleModuleAccess, updateRole } from '@/lib/admin/people'

export async function createRoleAction(name: string, description?: string) {
  return createRole({ name, description })
}

export async function updateRoleAction(
  roleId: string,
  patch: { name?: string; description?: string },
) {
  return updateRole(roleId, patch)
}

export async function deleteRoleAction(roleId: string) {
  return deleteRole(roleId)
}

export async function setRoleModuleAccessAction(
  roleId: string,
  moduleId: string,
  accessLevel: 'none' | 'read' | 'write' | 'admin',
) {
  return setRoleModuleAccess(roleId, moduleId, accessLevel)
}
