'use server'

import {
  discardFormSchemaDraft,
  publishFormSchema,
  saveFormSchemaDraft,
} from '@/lib/forms/publish'

export async function saveDraftAction(formSchemaId: string, draft: unknown) {
  return saveFormSchemaDraft(formSchemaId, draft)
}

export async function publishAction(formSchemaId: string) {
  return publishFormSchema(formSchemaId)
}

export async function discardDraftAction(formSchemaId: string) {
  return discardFormSchemaDraft(formSchemaId)
}
