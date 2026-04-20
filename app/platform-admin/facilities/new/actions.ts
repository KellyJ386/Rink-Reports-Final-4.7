'use server'

import { createFacilityWithFirstAdmin, type CreateFacilityInput } from '@/lib/facility/create'

export async function createFacilityAction(input: CreateFacilityInput) {
  return createFacilityWithFirstAdmin(input)
}
