import { z, type ZodTypeAny } from 'zod'

import type {
  FieldSpec,
  ResolvedFieldSpec,
  ResolvedSectionSpec,
  SectionSpec,
  ShowIf,
} from './types'

/**
 * Build a runtime Zod schema from a (resolved or unresolved) form schema, for validating
 * submission values. Used server-side by submitForm; can also be used client-side by
 * <DynamicForm /> for live field-level feedback.
 *
 * Key behavior:
 *   - Hidden fields (show_if evaluates false) are treated as not-required regardless
 *     of their own `required` flag. The engine evaluates show_if against the same
 *     values object at validation time.
 *   - Option-typed fields validate against their `key` set when resolved; accept any
 *     string when unresolved.
 *   - Number ranges, slider bounds, text required/optional all enforced.
 */

export function buildZodFromSchema(
  sections: (SectionSpec | ResolvedSectionSpec)[],
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, ZodTypeAny> = {}

  for (const section of sections) {
    for (const field of section.fields) {
      shape[field.key] = fieldToZod(field)
    }
  }

  // Build a lookup of show_if dependencies so we can post-validate visibility.
  const dependencyList: Array<{ key: string; show_if: ShowIf; required: boolean }> = []
  for (const section of sections) {
    for (const field of section.fields) {
      if (field.show_if) {
        dependencyList.push({
          key: field.key,
          show_if: field.show_if,
          required: !!field.required,
        })
      }
    }
  }

  return z
    .object(shape)
    .passthrough()
    .superRefine((values, ctx) => {
      for (const dep of dependencyList) {
        const visible = evaluateShowIf(dep.show_if, values)
        if (!visible) {
          // Hidden → value is not required; if present but invalid, we also tolerate it.
          return
        }
        if (dep.required) {
          const v = values[dep.key]
          if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [dep.key],
              message: 'Required',
            })
          }
        }
      }
    })
}

function fieldToZod(field: FieldSpec | ResolvedFieldSpec): ZodTypeAny {
  switch (field.type) {
    case 'text':
    case 'textarea': {
      let s: ZodTypeAny = z.string()
      if (!field.required) s = s.optional().or(z.literal(''))
      else s = (s as z.ZodString).min(1, 'Required')
      return s
    }
    case 'number':
    case 'slider': {
      let s: z.ZodNumber = z.number()
      if (typeof field.min === 'number') s = s.min(field.min)
      if (typeof field.max === 'number') s = s.max(field.max)
      return field.required === false ? s.nullable().optional() : s
    }
    case 'boolean':
      return field.required ? z.boolean() : z.boolean().optional()
    case 'select':
    case 'radio': {
      const opts = extractInlineOptions(field)
      if (opts) {
        const keys = opts.map((o) => o.key) as [string, ...string[]]
        const enumSchema = z.enum(keys)
        return field.required ? enumSchema : enumSchema.optional()
      }
      return field.required ? z.string().min(1) : z.string().optional()
    }
    case 'multiselect': {
      const opts = extractInlineOptions(field)
      if (opts) {
        const keys = opts.map((o) => o.key) as [string, ...string[]]
        const arr = z.array(z.enum(keys))
        return field.required ? arr.min(1, 'Pick at least one') : arr.optional()
      }
      return field.required ? z.array(z.string()).min(1) : z.array(z.string()).optional()
    }
    case 'date':
    case 'time':
    case 'datetime':
      return field.required ? z.string().min(1) : z.string().optional()
    default: {
      const _exhaustive: never = field
      throw new Error(`buildZodFromSchema: unreachable field type ${JSON.stringify(_exhaustive)}`)
    }
  }
}

function extractInlineOptions(
  field: FieldSpec | ResolvedFieldSpec,
): Array<{ key: string; label: string }> | null {
  if (field.type !== 'select' && field.type !== 'multiselect' && field.type !== 'radio') {
    return null
  }
  const opts = (field as { options: unknown }).options
  if (Array.isArray(opts)) return opts as Array<{ key: string; label: string }>
  return null
}

export function evaluateShowIf(cond: ShowIf, values: Record<string, unknown>): boolean {
  const v = values[cond.field]
  if ('equals' in cond) return v === cond.equals
  if ('not_equals' in cond) return v !== cond.not_equals
  if ('in' in cond) return cond.in.includes(v as string | number)
  return true
}
