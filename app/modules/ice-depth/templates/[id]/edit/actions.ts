'use server'

import {
  discardTemplateDraft,
  publishTemplate,
  saveTemplateDraft,
  type SaveTemplateDraftInput,
} from '@/lib/ice-depth/template'

export async function saveDraftAction(input: SaveTemplateDraftInput) {
  return saveTemplateDraft(input)
}

export async function publishAction(templateId: string) {
  return publishTemplate(templateId)
}

export async function discardDraftAction(templateId: string) {
  return discardTemplateDraft(templateId)
}
