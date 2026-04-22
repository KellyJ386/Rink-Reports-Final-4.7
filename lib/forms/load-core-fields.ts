import 'server-only'

import type { z } from 'zod'

import { getRegistryForm } from './module-registry'
import type { ResolvedSectionSpec, SectionSpec } from './types'

/**
 * The three symbols every module's core-fields.ts file must export.
 *
 * Authoritative path: `app/modules/_registry.ts` MODULE_REGISTRY entries.
 * The registry stores each file's absolute-from-repo-root path — not a
 * slug-derived template — so snake_case DB slugs (`ice_maintenance`,
 * `air_quality`) and kebab-case on-disk directories (`ice-maintenance/`,
 * `air-quality/`) coexist cleanly.
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
 * Dynamically import the core-fields module for a given `(moduleSlug, formType)`.
 *
 * Resolution:
 *   1. Look up the `(moduleSlug, formType)` pair in the registry.
 *   2. Parse the registry's `coreFieldsPath` into directory segments.
 *   3. Dynamic-import by template literal with the parsed segments. Two
 *      distinct template shapes — one for multi-form modules, one for
 *      single-form — so webpack can scan each candidate set independently
 *      and build a correct module manifest at build time.
 *
 * Throws on: missing registry entry, malformed registry path, or import
 * failure. The registry-filesystem unit test ensures (2) never fails in
 * practice — every committed entry has an existing file with the right
 * exports, and its path matches the expected shape.
 */
export async function loadCoreFields(
  moduleSlug: string,
  formType: string | null,
): Promise<CoreFieldsModule> {
  const form = getRegistryForm(moduleSlug, formType)
  if (!form) {
    throw new Error(
      `loadCoreFields: no registry entry for module "${moduleSlug}"${
        formType ? `, form_type "${formType}"` : ''
      }. ` +
        `Add an entry to app/modules/_registry.ts or check the slug + form_type match the DB.`,
    )
  }

  // Parse coreFieldsPath → directory segments. Shape enforced by the
  // registry-filesystem unit test; if this regex fails, the registry is
  // corrupt (shouldn't hit in practice).
  const match = form.coreFieldsPath.match(
    /^app\/modules\/([^/]+)(?:\/([^/]+))?\/core-fields\.ts$/,
  )
  if (!match) {
    throw new Error(
      `loadCoreFields: registry coreFieldsPath "${form.coreFieldsPath}" does not match the expected shape ` +
        `"app/modules/<dir>[/<form-type-dir>]/core-fields.ts". Fix the entry in app/modules/_registry.ts.`,
    )
  }
  const moduleDir = match[1]
  const formTypeDir = match[2] // undefined for single-form modules

  try {
    // Two distinct template-literal shapes below — webpack scans each for
    // candidate modules at build time. Mixing into one dynamic-expression
    // import would collapse the manifests and resolve poorly.
    const mod = formTypeDir
      ? await import(`@/app/modules/${moduleDir}/${formTypeDir}/core-fields`)
      : await import(`@/app/modules/${moduleDir}/core-fields`)
    assertShape(mod, moduleSlug, formType)
    return mod
  } catch (err) {
    throw new Error(
      `loadCoreFields: failed to import core-fields for module "${moduleSlug}"` +
        (formType ? `, form_type "${formType}"` : '') +
        ` (path: ${form.coreFieldsPath}). ` +
        `Expected exports: coreFieldsZodSchema, coreFieldsRenderSpec, coreFieldsDbColumns. ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
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
