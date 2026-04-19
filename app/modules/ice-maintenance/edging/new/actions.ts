'use server'

import { submitForm, type SubmitFormResult } from '@/lib/forms/submit'

export async function submitEdging(
  values: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<SubmitFormResult> {
  return submitForm({
    moduleSlug: 'ice_maintenance',
    formType: 'edging',
    values,
    idempotencyKey,
  })
}
