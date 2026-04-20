import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Admin server actions for Option Lists.
 *
 * Delete-safety rule: scan ONLY published schemas (form_schemas.schema_definition)
 * for `from_option_list: "<slug>"` references. Drafts are discardable — admins
 * should not be blocked from deleting a list because they have a stale draft.
 */

export async function createOptionList(input: {
  slug: string
  name: string
  description?: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!/^[a-z][a-z0-9_]*$/.test(input.slug)) {
    return {
      ok: false,
      error: 'Slug must be snake_case (lowercase letters, digits, underscores).',
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('option_lists')
    .insert({
      slug: input.slug,
      name: input.name,
      description: input.description ?? null,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, id: data.id as string }
}

export async function updateOptionList(
  id: string,
  patch: { name?: string; description?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Slug is immutable; we don't accept it in the patch shape.
  const supabase = await createClient()
  const { error } = await supabase.from('option_lists').update(patch).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function deleteOptionList(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; references?: string[] }> {
  const supabase = await createClient()

  // Load the slug and scan published schemas
  const { data: list } = await supabase.from('option_lists').select('slug').eq('id', id).maybeSingle()
  if (!list) return { ok: false, error: 'Option list not found' }

  const refs = await scanPublishedSchemasForOptionListSlug(supabase, list.slug as string)
  if (refs.length > 0) {
    return {
      ok: false,
      error: `Cannot delete: published form schemas reference this list.`,
      references: refs,
    }
  }

  const { error } = await supabase.from('option_lists').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

async function scanPublishedSchemasForOptionListSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  slug: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('form_schemas')
    .select('module_slug, form_type, schema_definition')

  const refs: string[] = []
  for (const row of (data ?? []) as Array<{
    module_slug: string
    form_type: string | null
    schema_definition: unknown
  }>) {
    if (schemaReferencesOptionList(row.schema_definition, slug)) {
      refs.push(`${row.module_slug}${row.form_type ? ':' + row.form_type : ''}`)
    }
  }
  return refs
}

function schemaReferencesOptionList(schema: unknown, slug: string): boolean {
  if (!schema || typeof schema !== 'object') return false
  const sections = (schema as { sections?: unknown }).sections
  if (!Array.isArray(sections)) return false
  for (const section of sections) {
    const fields = (section as { fields?: unknown }).fields
    if (!Array.isArray(fields)) continue
    for (const field of fields) {
      const options = (field as { options?: unknown }).options
      if (
        options &&
        typeof options === 'object' &&
        'from_option_list' in (options as object) &&
        (options as { from_option_list: string }).from_option_list === slug
      ) {
        return true
      }
    }
  }
  return false
}

// ----------------------------------------------------------------------------
// Items
// ----------------------------------------------------------------------------

export async function createOptionListItem(input: {
  option_list_id: string
  key: string
  label: string
  sort_order?: number
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!/^[a-z0-9][a-z0-9_]*$/.test(input.key)) {
    return {
      ok: false,
      error: 'Key must start with a lowercase letter or digit and contain only lowercase letters, digits, and underscores.',
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('option_list_items')
    .insert({
      option_list_id: input.option_list_id,
      key: input.key,
      label: input.label,
      sort_order: input.sort_order ?? 0,
      is_active: true,
    })
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, id: data.id as string }
}

export async function updateOptionListItem(
  id: string,
  patch: { label?: string; sort_order?: number; is_active?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  // key is trigger-immutable at the DB layer; we don't accept it here.
  const supabase = await createClient()
  const { error } = await supabase.from('option_list_items').update(patch).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
