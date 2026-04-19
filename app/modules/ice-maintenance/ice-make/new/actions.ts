'use server'

import { submitForm, type SubmitFormResult } from '@/lib/forms/submit'

export async function submitIceMake(
  values: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<SubmitFormResult> {
  return submitForm({
    moduleSlug: 'ice_maintenance',
    formType: 'ice_make',
    values,
    idempotencyKey,
  })
}
