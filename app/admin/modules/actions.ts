'use server'

import { setFacilityModuleEnabled } from '@/lib/admin/configuration'

export async function toggleModuleAction(moduleSlug: string, isEnabled: boolean) {
  return setFacilityModuleEnabled(moduleSlug, isEnabled)
}
