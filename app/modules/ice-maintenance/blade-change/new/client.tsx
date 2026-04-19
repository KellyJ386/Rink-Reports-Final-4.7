'use client'

import { useRouter } from 'next/navigation'
import { useMemo } from 'react'

import {
  DynamicForm,
  type DynamicFormSubmitResult,
  type DynamicFormValues,
} from '@/components/dynamic-form/DynamicForm'
import type { ResolvedSectionSpec } from '@/lib/forms/types'

import { submitBladeChange } from './actions'

type Props = { sections: ResolvedSectionSpec[] }

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `k_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

export function NewBladeChangeClient({ sections }: Props) {
  const router = useRouter()
  const idempotencyKey = useMemo(() => newIdempotencyKey(), [])

  return (
    <DynamicForm
      sections={sections}
      submitLabel="File blade change"
      onSubmit={async (values: DynamicFormValues): Promise<DynamicFormSubmitResult> => {
        const result = await submitBladeChange(values, idempotencyKey)
        if (result.ok) {
          router.push('/modules/ice-maintenance/blade-change')
          router.refresh()
        }
        return result
      }}
    />
  )
}
