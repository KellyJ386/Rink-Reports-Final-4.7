/**
 * Shared types for the form engine. These mirror the runtime Zod meta-schema in
 * lib/forms/meta-schema.ts — edit together.
 *
 * Wire format: stored as jsonb in form_schemas.schema_definition. The `$schema`
 * marker identifies the format version so future breaking changes can migrate.
 */

export const FORM_SCHEMA_FORMAT_VERSION = 'rink-form-schema/v1' as const

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'radio'
  | 'date'
  | 'time'
  | 'datetime'
  | 'slider'

export type InlineOption = { key: string; label: string }

export type OptionSource =
  | InlineOption[]
  | { from_option_list: string }
  | { from_resource_type: string }

export type ShowIf =
  | { field: string; equals: string | number | boolean }
  | { field: string; not_equals: string | number | boolean }
  | { field: string; in: Array<string | number> }

type BaseField = {
  key: string
  label: string
  help_text?: string
  required?: boolean
  show_if?: ShowIf
}

export type FieldSpec =
  | (BaseField & { type: 'text' })
  | (BaseField & { type: 'textarea'; rows?: number })
  | (BaseField & { type: 'number'; min?: number; max?: number; step?: number; unit?: string })
  | (BaseField & { type: 'boolean' })
  | (BaseField & { type: 'select'; options: OptionSource })
  | (BaseField & { type: 'multiselect'; options: OptionSource })
  | (BaseField & { type: 'radio'; options: OptionSource })
  | (BaseField & { type: 'date' })
  | (BaseField & { type: 'time' })
  | (BaseField & { type: 'datetime' })
  | (BaseField & { type: 'slider'; min: number; max: number; step?: number; unit?: string })

export type SectionSpec = {
  key: string
  label: string
  fields: FieldSpec[]
}

export type FormSchemaDefinitionDoc = {
  $schema?: typeof FORM_SCHEMA_FORMAT_VERSION
  sections: SectionSpec[]
}

/**
 * Fully-resolved form schema ready for rendering. Server-side resolution has replaced
 * every `from_option_list` / `from_resource_type` reference with an inline array.
 */
export type ResolvedFieldSpec = Omit<FieldSpec, 'options'> &
  (
    | { type: Exclude<FieldSpec['type'], 'select' | 'multiselect' | 'radio'> }
    | { type: 'select' | 'multiselect' | 'radio'; options: InlineOption[] }
  )

export type ResolvedSectionSpec = {
  key: string
  label: string
  fields: ResolvedFieldSpec[]
  /** True for sections that come from the module's core-fields registry; admins cannot edit them. */
  locked?: boolean
}

export type ResolvedFormSchema = {
  moduleSlug: string
  formType: string | null
  version: number
  sections: ResolvedSectionSpec[]
}

/**
 * Offline queue hook point — Agent 7 implements the actual queue against this shape.
 * The client uuid doubles as the idempotency_key on the submission.
 */
export type QueuedSubmission = {
  /** Client-generated uuid; also the idempotency_key on the server. */
  id: string
  module_slug: string
  form_type: string | null
  payload: Record<string, unknown>
  created_at: string
  attempts: number
  last_error?: string
  status: 'queued' | 'in_flight' | 'synced' | 'failed'
}
