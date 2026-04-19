import 'server-only'

import type { z } from 'zod'

import type { ResolvedSectionSpec, SectionSpec } from './types'

/**
 * The three symbols every module's core-fields.ts file must export.
 *
 * Path convention:
 *   Single-form modules:   app/modules/<module-slug>/core-fields.ts
 *   Multi-form modules:    app/modules/<module-slug>/<form-type>/core-fields.ts
 */
export type CoreFieldsModule = {
  coreFieldsZodSchema: z.ZodTypeAny
  /**
   * Render spec for the core fields. Uses the same section/field shape as custom
   * fields but rendered with a `locked` flag so the admin editor disables editing.
   * Option sources (from_option_list, from_resource_type) are resolved alongside
   * custom fields during load.
   */
  coreFieldsRenderSpec: SectionSpec[]
  /**
   * Column names on the submission table that are populated from the core-fields
   * half of the form payload. Everything else goes into custom_fields jsonb.
   */
  coreFieldsDbColumns: string[]
}

/**
 * Dynamically import the core-fields module for a given (module, form_type).
 * Throws if the module is missing — modules that use the form engine MUST ship this
 * file at the conventional path.
 */
export async function loadCoreFields(
  moduleSlug: string,
  formType: string | null,
): Promise<CoreFieldsModule> {
  try {
    const mod = formType
      ? await import(`@/app/modules/${moduleSlug}/${formType}/core-fields`)
      : await import(`@/app/modules/${moduleSlug}/core-fields`)
    assertShape(mod, moduleSlug, formType)
    return mod
  } catch (err) {
    throw new Error(
      `loadCoreFields: failed to import core-fields for module "${moduleSlug}"` +
        (formType ? `, form_type "${formType}"` : '') +
        `. Expected exports: coreFieldsZodSchema, coreFieldsRenderSpec, coreFieldsDbColumns. Original error: ${
          err instanceof Error ? err.message : String(err)
        }`,
    )
  }
}

function assertShape(
  mod: Record<string, unknown>,
  moduleSlug: string,
  formType: string | null,
): asserts mod is CoreFieldsModule {
  const required = ['coreFieldsZodSchema', 'coreFieldsRenderSpec', 'coreFieldsDbColumns']
  for (const key of required) {
    if (!(key in mod)) {
      throw new Error(
        `core-fields for module "${moduleSlug}"${
          formType ? `, form_type "${formType}"` : ''
        } is missing required export "${key}"`,
      )
    }
  }
}

/**
 * Mark a list of resolved sections as locked (for the admin editor's visual cue).
 * Used when merging core-fields sections into the render stream ahead of custom fields.
 */
export function markLocked(sections: ResolvedSectionSpec[]): ResolvedSectionSpec[] {
  return sections.map((s) => ({ ...s, locked: true }))
}
