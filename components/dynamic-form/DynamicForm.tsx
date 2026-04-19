'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { FormProvider, useForm, type DefaultValues } from 'react-hook-form'

import { buildZodFromSchema, evaluateShowIf } from '@/lib/forms/build-zod'
import type { ResolvedSectionSpec } from '@/lib/forms/types'

import { FieldRenderer } from './field-renderers'

export type DynamicFormValues = Record<string, unknown>

export type DynamicFormSubmitResult = {
  ok: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

type Props = {
  sections: ResolvedSectionSpec[]
  initialValues?: DynamicFormValues
  submitLabel?: string
  onSubmit: (values: DynamicFormValues) => Promise<DynamicFormSubmitResult>
}

/**
 * Renders a form from a resolved form_schema. Core-fields sections (sections.locked
 * === true) render the same as custom — the "locked" flag only affects admin editor
 * rendering; for staff filling a form, core vs custom is invisible.
 */
export function DynamicForm({ sections, initialValues = {}, submitLabel = 'Submit', onSubmit }: Props) {
  const zod = useMemo(() => buildZodFromSchema(sections), [sections])
  const methods = useForm<DynamicFormValues>({
    resolver: zodResolver(zod),
    defaultValues: initialValues as DefaultValues<DynamicFormValues>,
    mode: 'onBlur',
  })

  const [submitError, setSubmitError] = useState<string | null>(null)
  const values = methods.watch()

  return (
    <FormProvider {...methods}>
      <form
        className="flex flex-col gap-6"
        onSubmit={methods.handleSubmit(async (data) => {
          setSubmitError(null)
          const result = await onSubmit(data)
          if (!result.ok) {
            setSubmitError(result.error ?? 'Submission failed')
            if (result.fieldErrors) {
              for (const [key, msg] of Object.entries(result.fieldErrors)) {
                methods.setError(key, { type: 'server', message: msg })
              }
            }
          }
        })}
      >
        {sections.map((section) => (
          <fieldset key={section.key} className="border border-hairline rounded-md p-4">
            <legend className="px-2 text-sm font-semibold text-muted uppercase tracking-wide">
              {section.label}
            </legend>
            <div className="flex flex-col gap-4 mt-2">
              {section.fields.map((field) => {
                if (field.show_if && !evaluateShowIf(field.show_if, values)) {
                  return null
                }
                return <FieldRenderer key={field.key} field={field} />
              })}
            </div>
          </fieldset>
        ))}

        {submitError && (
          <p role="alert" className="text-danger text-sm">
            {submitError}
          </p>
        )}

        <button
          type="submit"
          disabled={methods.formState.isSubmitting}
          className="self-start py-2"
        >
          {methods.formState.isSubmitting ? 'Submitting…' : submitLabel}
        </button>
      </form>
    </FormProvider>
  )
}
