import { NextResponse } from 'next/server'
import { z } from 'zod'

import { submitForm } from '@/lib/forms/submit'

/**
 * Bridge route handler for the offline queue's sync loop. Accepts a JSON body
 * identical to submitForm's input (plus idempotency_key) and invokes submitForm
 * server-side. Returns:
 *   200 + { id, idempotent_return } on success
 *   400 on validation failure (the queue marks the row 'failed' and shows the error)
 *   5xx on transient failure (queue retries with backoff)
 */

const Body = z.object({
  module_slug: z.string().min(1),
  form_type: z.string().nullable(),
  values: z.record(z.unknown()),
  idempotency_key: z.string().min(8),
})

export async function POST(request: Request) {
  let parsed
  try {
    parsed = Body.safeParse(await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const result = await submitForm({
    moduleSlug: parsed.data.module_slug,
    formType: parsed.data.form_type,
    values: parsed.data.values,
    idempotencyKey: parsed.data.idempotency_key,
  })

  if (!result.ok) {
    // Validation errors → 400 (queue marks failed). Other errors → 500 (queue retries).
    const isValidation = !!result.fieldErrors || result.error.toLowerCase().includes('validation')
    return NextResponse.json(
      { error: result.error, fieldErrors: result.fieldErrors ?? null },
      { status: isValidation ? 400 : 500 },
    )
  }

  return NextResponse.json({ id: result.id, idempotent_return: result.idempotentReturn })
}
