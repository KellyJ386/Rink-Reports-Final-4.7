'use server'

import { discardDraft, publishDraft, saveDraft } from '@/lib/forms/editor'

/**
 * Slim migration from Phase 1 `lib/forms/publish.ts` to Phase 2 Seam 1
 * `lib/forms/editor.ts`. Same external call signatures so the existing
 * FormSchemaEditor component needs zero changes — but every save/publish
 * now runs through the editor contract:
 *
 *   - Explicit admin gate (`has_module_access('admin_control_center', 'admin')`)
 *     before any write. Phase 1 relied on RPC-internal checks; Seam 1 moved
 *     it to the TS boundary as well, defense in depth.
 *   - Key-immutability enforcement — renames or removals of previously-published
 *     field keys are rejected with a structured error. The slim UI surfaces
 *     these via the existing `result.error` message; a follow-up PR renders
 *     `keyImmutabilityErrors` as field-level annotations.
 *
 * Return shapes are supersets of the Phase 1 contract (same `ok`, `error`,
 * `validationErrors` fields; new `keyImmutabilityErrors` is additive), so
 * existing callers continue to work unchanged.
 */

export async function saveDraftAction(formSchemaId: string, draft: unknown) {
  return saveDraft({ schemaId: formSchemaId, draftDefinition: draft })
}

export async function publishAction(formSchemaId: string) {
  return publishDraft({ schemaId: formSchemaId })
}

export async function discardDraftAction(formSchemaId: string) {
  return discardDraft({ schemaId: formSchemaId })
}
