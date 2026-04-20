'use server'

import {
  createFacilityResource,
  type CreateResourceInput,
  updateFacilityResource,
} from '@/lib/admin/configuration'

export async function createResourceAction(input: CreateResourceInput) {
  return createFacilityResource(input)
}

export async function updateResourceAction(
  id: string,
  patch: { name?: string; sort_order?: number; is_active?: boolean },
) {
  return updateFacilityResource(id, patch)
}
