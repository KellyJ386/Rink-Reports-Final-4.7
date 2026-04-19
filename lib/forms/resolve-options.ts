import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  FieldSpec,
  InlineOption,
  OptionSource,
  ResolvedFieldSpec,
  ResolvedSectionSpec,
  SectionSpec,
} from './types'

/**
 * Resolve every option source (from_option_list / from_resource_type) into an inline
 * array of {key, label} pairs. Executed server-side (RSC) so the client never touches
 * option data.
 *
 * Option lists and resources are filtered by current_facility_id() via RLS; the
 * caller's Supabase client must be the authenticated user's, not service role,
 * so tenant isolation holds.
 */
export async function resolveOptions(
  sections: SectionSpec[],
  supabase: SupabaseClient,
): Promise<ResolvedSectionSpec[]> {
  const listSlugs = new Set<string>()
  const resourceTypes = new Set<string>()

  for (const section of sections) {
    for (const field of section.fields) {
      const src = extractOptionSource(field)
      if (src && 'from_option_list' in src) listSlugs.add(src.from_option_list)
      if (src && 'from_resource_type' in src) resourceTypes.add(src.from_resource_type)
    }
  }

  const [listsMap, resourcesMap] = await Promise.all([
    loadOptionLists(supabase, [...listSlugs]),
    loadFacilityResources(supabase, [...resourceTypes]),
  ])

  return sections.map((section) => ({
    ...section,
    fields: section.fields.map((field): ResolvedFieldSpec => resolveField(field, listsMap, resourcesMap)),
  }))
}

function extractOptionSource(field: FieldSpec): OptionSource | null {
  switch (field.type) {
    case 'select':
    case 'multiselect':
    case 'radio':
      return field.options
    default:
      return null
  }
}

function resolveField(
  field: FieldSpec,
  listsMap: Map<string, InlineOption[]>,
  resourcesMap: Map<string, InlineOption[]>,
): ResolvedFieldSpec {
  const src = extractOptionSource(field)
  if (!src) return field as ResolvedFieldSpec

  let resolved: InlineOption[]
  if (Array.isArray(src)) {
    resolved = src
  } else if ('from_option_list' in src) {
    resolved = listsMap.get(src.from_option_list) ?? []
  } else {
    resolved = resourcesMap.get(src.from_resource_type) ?? []
  }

  return { ...field, options: resolved } as ResolvedFieldSpec
}

async function loadOptionLists(
  supabase: SupabaseClient,
  slugs: string[],
): Promise<Map<string, InlineOption[]>> {
  const map = new Map<string, InlineOption[]>()
  if (slugs.length === 0) return map

  const { data, error } = await supabase
    .from('option_lists')
    .select('slug, option_list_items(key, label, sort_order, is_active)')
    .in('slug', slugs)

  if (error || !data) {
    console.error('resolveOptions: option_lists fetch failed', error)
    return map
  }

  for (const list of data as Array<{
    slug: string
    option_list_items: Array<{ key: string; label: string; sort_order: number; is_active: boolean }>
  }>) {
    const active = (list.option_list_items ?? [])
      .filter((i) => i.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ key: i.key, label: i.label }))
    map.set(list.slug, active)
  }
  return map
}

async function loadFacilityResources(
  supabase: SupabaseClient,
  types: string[],
): Promise<Map<string, InlineOption[]>> {
  const map = new Map<string, InlineOption[]>()
  if (types.length === 0) return map

  const { data, error } = await supabase
    .from('facility_resources')
    .select('id, resource_type, name, sort_order, is_active')
    .in('resource_type', types)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error || !data) {
    console.error('resolveOptions: facility_resources fetch failed', error)
    return map
  }

  for (const row of data as Array<{
    id: string
    resource_type: string
    name: string
  }>) {
    const list = map.get(row.resource_type) ?? []
    list.push({ key: row.id, label: row.name })
    map.set(row.resource_type, list)
  }
  return map
}
