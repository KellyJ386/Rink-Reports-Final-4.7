import { z } from 'zod'

import { FORM_SCHEMA_FORMAT_VERSION } from './types'

/**
 * Meta-schema: validates form_schemas.schema_definition documents.
 * Publish server action runs this before accepting a draft, rejecting malformed
 * documents at publish time rather than at render time.
 */

const KEY = z.string().regex(/^[a-z][a-z0-9_]*$/, 'keys must be snake_case starting with a letter')
const OPTION_KEY = z.string().regex(/^[a-z0-9][a-z0-9_]*$/)

const InlineOption = z.object({
  key: OPTION_KEY,
  label: z.string().min(1),
})

const OptionSource = z.union([
  z.array(InlineOption).min(1),
  z.object({ from_option_list: z.string().min(1) }).strict(),
  z.object({ from_resource_type: z.string().min(1) }).strict(),
])

const ShowIf = z
  .object({
    field: z.string(),
    equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
    not_equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
    in: z.array(z.union([z.string(), z.number()])).optional(),
  })
  .refine(
    (s) =>
      s.equals !== undefined || s.not_equals !== undefined || s.in !== undefined,
    { message: 'show_if must specify one of: equals, not_equals, in' },
  )

const BaseField = z.object({
  key: KEY,
  label: z.string().min(1),
  help_text: z.string().optional(),
  required: z.boolean().default(false),
  show_if: ShowIf.optional(),
})

export const FieldSpec = z.discriminatedUnion('type', [
  BaseField.extend({ type: z.literal('text') }),
  BaseField.extend({
    type: z.literal('textarea'),
    rows: z.number().int().min(1).max(20).optional(),
  }),
  BaseField.extend({
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    unit: z.string().optional(),
  }),
  BaseField.extend({ type: z.literal('boolean') }),
  BaseField.extend({ type: z.literal('select'), options: OptionSource }),
  BaseField.extend({ type: z.literal('multiselect'), options: OptionSource }),
  BaseField.extend({ type: z.literal('radio'), options: OptionSource }),
  BaseField.extend({ type: z.literal('date') }),
  BaseField.extend({ type: z.literal('time') }),
  BaseField.extend({ type: z.literal('datetime') }),
  BaseField.extend({
    type: z.literal('slider'),
    min: z.number(),
    max: z.number(),
    step: z.number().optional(),
    unit: z.string().optional(),
  }),
])

const SectionSpec = z.object({
  key: KEY,
  label: z.string().min(1),
  fields: z.array(FieldSpec).min(1),
})

export const FormSchemaDefinitionDoc = z
  .object({
    $schema: z.literal(FORM_SCHEMA_FORMAT_VERSION).optional(),
    sections: z.array(SectionSpec).min(1),
  })
  .superRefine((schema, ctx) => {
    // 1) field.key uniqueness across all sections
    const seen = new Map<string, string>() // key → section.key
    for (const section of schema.sections) {
      for (const field of section.fields) {
        if (seen.has(field.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['sections'],
            message: `duplicate field key "${field.key}" in sections "${seen.get(
              field.key,
            )}" and "${section.key}"`,
          })
        }
        seen.set(field.key, section.key)
      }
    }

    // 2) show_if must reference a previously-defined field (no forward refs)
    const priorKeys = new Set<string>()
    for (const section of schema.sections) {
      for (const field of section.fields) {
        if (field.show_if && !priorKeys.has(field.show_if.field)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['sections'],
            message: `field "${field.key}".show_if references "${field.show_if.field}" which is not defined above`,
          })
        }
        priorKeys.add(field.key)
      }
    }
  })

export type FormSchemaDefinitionParsed = z.infer<typeof FormSchemaDefinitionDoc>

/**
 * Validate a JSONB object claimed to be a form_schema definition. Returns the parsed
 * document or a flat error list suitable for surfacing in the admin editor.
 */
export function validateFormSchema(raw: unknown):
  | { ok: true; value: FormSchemaDefinitionParsed }
  | { ok: false; errors: Array<{ path: string; message: string }> } {
  const result = FormSchemaDefinitionDoc.safeParse(raw)
  if (result.success) return { ok: true, value: result.data }
  return {
    ok: false,
    errors: result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  }
}
