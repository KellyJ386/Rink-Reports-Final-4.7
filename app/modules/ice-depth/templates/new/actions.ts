'use server'

import { createTemplate, type CreateTemplateInput } from '@/lib/ice-depth/template'

export async function createTemplateAction(input: CreateTemplateInput) {
  return createTemplate(input)
}
