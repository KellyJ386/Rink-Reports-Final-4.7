'use server'

import { discardDraft, publishDraft, saveDraft, validateDraft } from '@/lib/forms/editor'

/**
 * Thin server-action shim over `lib/forms/editor.ts` (Phase 2 Seam 1).
 *
 * saveDraft / publishDraft / discardDraft run admin-gated + key-immutability-
 * enforced writes. validateDraft is the editor's live-feedback path — pure,
 * no writes, no admin gate (cost-sensitive; fires on every keystroke once
 * debounced).
 *
 * Return shapes are supersets of Phase 1 (additive `keyImmutabilityErrors`),
 * so existing callers keep working.
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

export async function validateDraftAction(formSchemaId: string, draft: unknown) {
  return validateDraft({ schemaId: formSchemaId, draftDefinition: draft })
}
