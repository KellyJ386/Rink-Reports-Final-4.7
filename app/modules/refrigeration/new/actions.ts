'use server'

import { submitForm, type SubmitFormResult } from '@/lib/forms/submit'

export async function submitRefrigeration(
  values: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<SubmitFormResult> {
  return submitForm({
    moduleSlug: 'refrigeration',
    formType: null,
    values,
    idempotencyKey,
  })
}
