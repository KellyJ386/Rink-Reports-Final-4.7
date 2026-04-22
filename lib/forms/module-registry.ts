/**
 * Module-registry accessors used by the form engine at runtime.
 *
 * The registry data lives in `app/modules/_registry.ts`. This file is the
 * query interface: `getRegistryEntry(slug)`, `getRegistryForm(slug, formType)`,
 * and a backwards-compatible `getSubmissionTable(slug)` that supersedes the
 * hand-rolled map in `lib/forms/submission-tables.ts`.
 *
 * Why split: the registry file is plain data (consumable by tests without
 * pulling in server-only code); this file can evolve lookup semantics without
 * churning the registry.
 */

import {
  CUSTOM_UI_MODULE_SLUGS,
  MODULE_REGISTRY,
  type RegistryEntry,
  type RegistryForm,
} from '@/app/modules/_registry'

export function getRegistryEntry(slug: string): RegistryEntry | null {
  return MODULE_REGISTRY.find((e) => e.slug === slug) ?? null
}

export function getRegistryForm(
  slug: string,
  formType: string | null,
): RegistryForm | null {
  const entry = getRegistryEntry(slug)
  if (!entry) return null
  return entry.forms.find((f) => f.formType === formType) ?? null
}

export type SubmissionTableConfig = {
  tableName: string
  /** True if the table discriminates form types via a `form_type` column. */
  hasFormTypeColumn: boolean
}

/**
 * Resolve the submission table for a module. Throws if the slug isn't in the
 * registry, exactly like the Phase 1 implementation — better to fail fast than
 * write to a table that might not exist.
 *
 * Behavior match with Phase 1 `lib/forms/submission-tables.ts`:
 *   - Registered form-engine modules return { tableName, hasFormTypeColumn }
 *   - Custom-UI modules throw a clear error pointing the caller at their own
 *     server actions
 *   - Unknown slugs throw
 *
 * Phase 1's fallback-to-convention (`${slug}_submissions`) is gone: every
 * form-engine module must be explicitly registered. This is the whole point
 * of Seam 3 — no more "looks right by convention, drifts silently."
 */
export function getSubmissionTable(moduleSlug: string): SubmissionTableConfig {
  const entry = getRegistryEntry(moduleSlug)
  if (entry) {
    return {
      tableName: entry.submissionTable,
      hasFormTypeColumn: entry.hasFormTypeColumn,
    }
  }

  if ((CUSTOM_UI_MODULE_SLUGS as readonly string[]).includes(moduleSlug)) {
    throw new Error(
      `getSubmissionTable: module "${moduleSlug}" does not use the form engine. ` +
        `Submissions for this module go through its own server actions, not submitForm.`,
    )
  }

  throw new Error(
    `getSubmissionTable: module "${moduleSlug}" is not in the registry ` +
      `(app/modules/_registry.ts). If this is a new form-engine module, add it. ` +
      `If it's a custom-UI module, add it to CUSTOM_UI_MODULE_SLUGS.`,
  )
}

/**
 * List every `(slug, formType)` pair the engine knows about. Used by tests
 * and by tooling that walks the full module set (e.g. Agent 6's admin editor
 * "which form would you like to edit?" picker).
 */
export function listAllRegisteredForms(): Array<{
  slug: string
  formType: string | null
  submissionTable: string
  coreFieldsPath: string
}> {
  const out: Array<{
    slug: string
    formType: string | null
    submissionTable: string
    coreFieldsPath: string
  }> = []
  for (const entry of MODULE_REGISTRY) {
    for (const form of entry.forms) {
      out.push({
        slug: entry.slug,
        formType: form.formType,
        submissionTable: entry.submissionTable,
        coreFieldsPath: form.coreFieldsPath,
      })
    }
  }
  return out
}
