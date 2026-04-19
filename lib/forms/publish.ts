import 'server-only'

import { createClient } from '@/lib/supabase/server'

import { validateFormSchema } from './meta-schema'

export type PublishResult =
  | { ok: true; new_version: number; published_at: string }
  | { ok: false; error: string; validationErrors?: Array<{ path: string; message: string }> }

/**
 * Publish the current draft_definition for a form_schema.
 *
 * 1. Fetch the row (RLS scopes to caller's facility)
 * 2. Validate draft_definition against the meta-schema
 * 3. Call rpc_publish_form_schema (snapshots + swaps + bumps + audits atomically)
 */
export async function publishFormSchema(formSchemaId: string): Promise<PublishResult> {
  const supabase = await createClient()

  const { data: row, error: loadErr } = await supabase
    .from('form_schemas')
    .select('draft_definition')
    .eq('id', formSchemaId)
    .maybeSingle()

  if (loadErr) return { ok: false, error: loadErr.message }
  if (!row) return { ok: false, error: 'form_schema not found or not accessible' }
  if (!row.draft_definition) return { ok: false, error: 'No draft to publish' }

  const validation = validateFormSchema(row.draft_definition)
  if (!validation.ok) {
    return { ok: false, error: 'Draft did not pass meta-schema validation', validationErrors: validation.errors }
  }

  const { data, error } = await supabase.rpc('rpc_publish_form_schema', {
    p_form_schema_id: formSchemaId,
  })

  if (error) return { ok: false, error: error.message }
  const result = Array.isArray(data) ? data[0] : data
  if (!result?.new_version) return { ok: false, error: 'Publish RPC returned no version' }

  return {
    ok: true,
    new_version: result.new_version,
    published_at: result.published_at,
  }
}

export async function discardFormSchemaDraft(formSchemaId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('rpc_discard_form_schema_draft', {
    p_form_schema_id: formSchemaId,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function saveFormSchemaDraft(
  formSchemaId: string,
  draftDefinition: unknown,
): Promise<{ ok: true } | { ok: false; error: string; validationErrors?: Array<{ path: string; message: string }> }> {
  const supabase = await createClient()

  const validation = validateFormSchema(draftDefinition)
  if (!validation.ok) {
    return { ok: false, error: 'Draft did not pass meta-schema validation', validationErrors: validation.errors }
  }

  const { error } = await supabase.rpc('rpc_save_form_schema_draft', {
    p_form_schema_id: formSchemaId,
    p_draft_definition: draftDefinition,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
