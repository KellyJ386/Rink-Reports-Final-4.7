'use server'

import { submitForm, type SubmitFormResult } from '@/lib/forms/submit'

export async function submitAccident(
  values: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<SubmitFormResult> {
  return submitForm({
    moduleSlug: 'accident',
    formType: null,
    values,
    idempotencyKey,
  })
}
