'use client'

import { useRouter } from 'next/navigation'
import { useMemo } from 'react'

import {
  DynamicForm,
  type DynamicFormSubmitResult,
  type DynamicFormValues,
} from '@/components/dynamic-form/DynamicForm'
import type { ResolvedSectionSpec } from '@/lib/forms/types'

import { submitCircleCheck } from './actions'

type Props = {
  sections: ResolvedSectionSpec[]
}

function newIdempotencyKey(): string {
  // Browser-native UUID where available; fall back to a simple random for SSR safety.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `k_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

export function NewCircleCheckClient({ sections }: Props) {
  const router = useRouter()
  // Memoize so retries reuse the same key (idempotency across double-tap / offline replay)
  const idempotencyKey = useMemo(() => newIdempotencyKey(), [])

  return (
    <DynamicForm
      sections={sections}
      submitLabel="File circle check"
      onSubmit={async (values: DynamicFormValues): Promise<DynamicFormSubmitResult> => {
        const result = await submitCircleCheck(values, idempotencyKey)
        if (result.ok) {
          router.push('/modules/ice-maintenance/circle-check')
          router.refresh()
        }
        return result
      }}
    />
  )
}
