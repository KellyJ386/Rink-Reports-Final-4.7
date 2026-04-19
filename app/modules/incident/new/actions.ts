'use server'

import { submitForm, type SubmitFormResult } from '@/lib/forms/submit'

export async function submitIncident(
  values: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<SubmitFormResult> {
  return submitForm({
    moduleSlug: 'incident',
    formType: null,
    values,
    idempotencyKey,
  })
}
