'use server'

import { submitForm, type SubmitFormResult } from '@/lib/forms/submit'

export async function submitAirQuality(
  values: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<SubmitFormResult> {
  return submitForm({
    moduleSlug: 'air_quality',
    formType: null,
    values,
    idempotencyKey,
  })
}
