'use server'

import {
  changeUserRole,
  deactivateUser,
  reactivateUser,
} from '@/lib/admin/people'

export async function changeUserRoleAction(userId: string, roleId: string) {
  return changeUserRole(userId, roleId)
}

export async function deactivateUserAction(userId: string, reason?: string) {
  return deactivateUser(userId, reason)
}

export async function reactivateUserAction(userId: string) {
  return reactivateUser(userId)
}
