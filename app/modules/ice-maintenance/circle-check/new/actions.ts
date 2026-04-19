'use server'

import { submitForm, type SubmitFormResult } from '@/lib/forms/submit'

export async function submitCircleCheck(
  values: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<SubmitFormResult> {
  return submitForm({
    moduleSlug: 'ice_maintenance',
    formType: 'circle_check',
    values,
    idempotencyKey,
  })
}
