'use client'

import type { FieldError } from 'react-hook-form'
import { Controller, useFormContext } from 'react-hook-form'

import type { ResolvedFieldSpec } from '@/lib/forms/types'

type Props = { field: ResolvedFieldSpec }

export function FieldRenderer({ field }: Props) {
  switch (field.type) {
    case 'text':
      return <TextField field={field} />
    case 'textarea':
      return <TextareaField field={field} />
    case 'number':
      return <NumberField field={field} />
    case 'boolean':
      return <BooleanField field={field} />
    case 'select':
      return <SelectField field={field} />
    case 'multiselect':
      return <MultiselectField field={field} />
    case 'radio':
      return <RadioField field={field} />
    case 'date':
      return <DateField field={field} />
    case 'time':
      return <TimeField field={field} />
    case 'datetime':
      return <DatetimeField field={field} />
    case 'slider':
      return <SliderField field={field} />
    default: {
      const _exhaustive: never = field
      void _exhaustive
      return null
    }
  }
}

function LabelWrap({
  field,
  children,
  error,
}: {
  field: ResolvedFieldSpec
  children: React.ReactNode
  error?: FieldError
}) {
  return (
    <label>
      <span>
        {field.label}
        {field.required && <span className="text-danger"> *</span>}
      </span>
      {field.help_text && <span className="text-muted font-normal text-xs">{field.help_text}</span>}
      {children}
      {error?.message && <span className="text-danger text-xs">{String(error.message)}</span>}
    </label>
  )
}

function TextField({ field }: { field: Extract<ResolvedFieldSpec, { type: 'text' }> }) {
  const { register, formState } = useFormContext()
  const err = formState.errors[field.key] as FieldError | undefined
  return (
    <LabelWrap field={field} error={err}>
      <input type="text" {...register(field.key)} />
    </LabelWrap>
  )
}

function TextareaField({ field }: { field: Extract<ResolvedFieldSpec, { type: 'textarea' }> }) {
  const { register, formState } = useFormContext()
  const err = formState.errors[field.key] as FieldError | undefined
  return (
    <LabelWrap field={field} error={err}>
      <textarea rows={field.rows ?? 4} {...register(field.key)} />
    </LabelWrap>
  )
}

function NumberField({ field }: { field: Extract<ResolvedFieldSpec, { type: 'number' }> }) {
  const { register, formState } = useFormContext()
  const err = formState.errors[field.key] as FieldError | undefined
  return (
    <LabelWrap field={field} error={err}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          min={field.min}
          max={field.max}
          step={field.step ?? 'any'}
          {...register(field.key, { valueAsNumber: true })}
        />
        {field.unit && <span className="text-muted text-sm">{field.unit}</span>}
      </div>
    </LabelWrap>
  )
}

function BooleanField({ field }: { field: Extract<ResolvedFieldSpec, { type: 'boolean' }> }) {
  const { register, formState } = useFormContext()
  const err = formState.errors[field.key] as FieldError | undefined
  return (
    <label className="flex-row items-center gap-2">
      <input type="checkbox" className="w-auto" {...register(field.key)} />
      <span>
        {field.label}
        {field.required && <span className="text-danger"> *</span>}
      </span>
      {field.help_text && <span className="text-muted font-normal text-xs">{field.help_text}</span>}
      {err?.message && <span className="text-danger text-xs">{String(err.message)}</span>}
    </label>
  )
}

function SelectField({ field }: { field: Extract<ResolvedFieldSpec, { type: 'select' }> }) {
  const { register, formState } = useFormContext()
  const err = formState.errors[field.key] as FieldError | undefined
  return (
    <LabelWrap field={field} error={err}>
      <select {...register(field.key)}>
        <option value="">Choose…</option>
        {field.options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </LabelWrap>
  )
}

function MultiselectField({ field }: { field: Extract<ResolvedFieldSpec, { type: 'multiselect' }> }) {
  const { control, formState } = useFormContext()
  const err = formState.errors[field.key] as FieldError | undefined
  return (
    <LabelWrap field={field} error={err}>
      <Controller
        control={control}
        name={field.key}
        defaultValue={[]}
        render={({ field: rhf }) => {
          const arr = Array.isArray(rhf.value) ? (rhf.value as string[]) : []
          return (
            <div className="flex flex-wrap gap-2">
              {field.options.map((o) => {
                const checked = arr.includes(o.key)
                return (
                  <label key={o.key} className="flex-row items-center gap-1 border border-hairline rounded px-2">
                    <input
                      type="checkbox"
                      className="w-auto"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(arr)
                        if (e.target.checked) next.add(o.key)
                        else next.delete(o.key)
                        rhf.onChange([...next])
                      }}
                    />
                    <span className="font-normal">{o.label}</span>
                  </label>
                )
              })}
            </div>
          )
        }}
      />
    </LabelWrap>
  )
}

function RadioField({ field }: { field: Extract<ResolvedFieldSpec, { type: 'radio' }> }) {
  const { register, formState } = useFormContext()
  const err = formState.errors[field.key] as FieldError | undefined
  return (
    <LabelWrap field={field} error={err}>
      <div className="flex flex-col gap-1">
        {field.options.map((o) => (
          <label key={o.key} className="flex-row items-center gap-2 font-normal">
            <input type="radio" className="w-auto" value={o.key} {...register(field.key)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </LabelWrap>
  )
}

function DateField({ field }: { field: Extract<ResolvedFieldSpec, { type: 'date' }> }) {
  const { register, formState } = useFormContext()
  const err = formState.errors[field.key] as FieldError | undefined
  return (
    <LabelWrap field={field} error={err}>
      <input type="date" {...register(field.key)} />
    </LabelWrap>
  )
}

function TimeField({ field }: { field: Extract<ResolvedFieldSpec, { type: 'time' }> }) {
  const { register, formState } = useFormContext()
  const err = formState.errors[field.key] as FieldError | undefined
  return (
    <LabelWrap field={field} error={err}>
      <input type="time" {...register(field.key)} />
    </LabelWrap>
  )
}

function DatetimeField({ field }: { field: Extract<ResolvedFieldSpec, { type: 'datetime' }> }) {
  const { register, formState } = useFormContext()
  const err = formState.errors[field.key] as FieldError | undefined
  return (
    <LabelWrap field={field} error={err}>
      <input type="datetime-local" {...register(field.key)} />
    </LabelWrap>
  )
}

function SliderField({ field }: { field: Extract<ResolvedFieldSpec, { type: 'slider' }> }) {
  const { control, formState } = useFormContext()
  const err = formState.errors[field.key] as FieldError | undefined
  return (
    <LabelWrap field={field} error={err}>
      <Controller
        control={control}
        name={field.key}
        defaultValue={field.min}
        render={({ field: rhf }) => {
          const value = typeof rhf.value === 'number' ? rhf.value : field.min
          return (
            <div className="flex flex-col gap-1">
              <input
                type="range"
                min={field.min}
                max={field.max}
                step={field.step ?? 1}
                value={value}
                onChange={(e) => rhf.onChange(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted">
                <span>
                  {field.min}
                  {field.unit && ` ${field.unit}`}
                </span>
                <span className="font-semibold text-ink">
                  {value}
                  {field.unit && ` ${field.unit}`}
                </span>
                <span>
                  {field.max}
                  {field.unit && ` ${field.unit}`}
                </span>
              </div>
            </div>
          )
        }}
      />
    </LabelWrap>
  )
}
