/**
 * Return types for the schema-editor server actions in lib/forms/editor.ts.
 *
 * Kept separate from `types.ts` (wire format) so the editor contract is
 * explicit and independently versionable. Agent 6's admin editor UI imports
 * from here.
 */

import type { FormSchemaDefinitionDoc } from './types'
import type { KeyImmutabilityError } from './key-immutability'

/**
 * Metadata the editor needs alongside the raw schema doc. Annotations are
 * computed from server state (core-fields registry, form_schema_history, the
 * facility's option_lists) and are always fresh per load call.
 */
export type EditorAnnotations = {
  /**
   * Field keys from the module's core-fields.ts registry. Admin UI renders
   * their sections with a locked visual state; they cannot be edited, moved,
   * or removed from the draft_definition (they don't live in draft_definition
   * at all — they're merged in at render time).
   */
  coreFieldKeys: string[]
  /**
   * Every custom-field key that has ever appeared in a published schema for
   * this (facility, module, form_type). Includes the current published set
   * plus every form_schema_history snapshot. A draft may not drop or rename
   * any of these — enforced in saveDraft / validateDraft via
   * enforceKeyImmutability.
   */
  protectedKeys: string[]
  /**
   * Slugs of option_lists belonging to the caller's facility. Editor UI
   * presents these as autocomplete sources when an admin configures a
   * select/radio/multiselect field with `from_option_list`.
   */
  availableOptionListSlugs: string[]
  /**
   * Known resource_type values that can be referenced via `from_resource_type`.
   * Hardcoded constant today; Seam 2 may graduate to a DB-backed list.
   */
  availableResourceTypes: string[]
}

export type EditorLoadResult =
  | {
      ok: true
      schemaId: string
      moduleSlug: string
      formType: string | null
      /** Currently-published schema. Never null on a row that exists. */
      published: FormSchemaDefinitionDoc
      /** In-progress draft, or null if no draft exists. */
      draft: FormSchemaDefinitionDoc | null
      version: number
      annotations: EditorAnnotations
    }
  | { ok: false; error: string }

export type EditorSaveResult =
  | { ok: true }
  | {
      ok: false
      error: string
      /** Meta-schema failures (malformed draft structure). */
      validationErrors?: Array<{ path: string; message: string }>
      /** Previously-published keys that the draft dropped or renamed. */
      keyImmutabilityErrors?: KeyImmutabilityError[]
    }

export type EditorValidateResult =
  | { ok: true }
  | {
      ok: false
      validationErrors?: Array<{ path: string; message: string }>
      keyImmutabilityErrors?: KeyImmutabilityError[]
    }

export type EditorPublishResult =
  | { ok: true; new_version: number; published_at: string }
  | {
      ok: false
      error: string
      validationErrors?: Array<{ path: string; message: string }>
      keyImmutabilityErrors?: KeyImmutabilityError[]
    }

export type EditorDiscardResult = { ok: true } | { ok: false; error: string }

/**
 * The hard-coded resource type list. Mirrors the switch in
 * load-form-schema.ts#friendlyResourceTypeName. When Seam 2 makes this
 * DB-driven, delete this constant and replace it with a query on
 * facility_resources distinct types.
 */
export const KNOWN_RESOURCE_TYPES = [
  'surface',
  'compressor',
  'zamboni',
  'air_quality_device',
  'shift_position',
] as const
