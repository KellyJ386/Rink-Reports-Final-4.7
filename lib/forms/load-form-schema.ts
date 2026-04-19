import 'server-only'

import { createClient } from '@/lib/supabase/server'

import { loadCoreFields, markLocked } from './load-core-fields'
import { resolveOptions } from './resolve-options'
import type { FormSchemaDefinitionDoc, ResolvedFormSchema } from './types'

/**
 * Load and resolve the published form_schema for (moduleSlug, formType) scoped to
 * the caller's facility via RLS. Returns a fully-resolved structure ready for
 * <DynamicForm />.
 *
 * Resolution steps:
 *   1. SELECT from form_schemas (RLS scopes to current facility)
 *   2. Load core-fields.ts for this module + form_type
 *   3. Resolve option sources (from_option_list, from_resource_type) in both
 *      core-fields spec and custom spec
 *   4. Merge: [ ...lockedCoreSections, ...customSections ]
 */
export async function loadPublishedFormSchema(
  moduleSlug: string,
  formType: string | null,
): Promise<{
  schema: ResolvedFormSchema
  formSchemaId: string
  coreFieldsDbColumns: string[]
  coreFieldsZodSchema: unknown
} | null> {
  const supabase = await createClient()

  // 1. Load form_schemas row
  const query = supabase
    .from('form_schemas')
    .select('id, module_slug, form_type, schema_definition, version, is_published')
    .eq('module_slug', moduleSlug)

  const { data, error } = formType
    ? await query.eq('form_type', formType).maybeSingle()
    : await query.is('form_type', null).maybeSingle()

  if (error) {
    console.error('loadPublishedFormSchema: query error', error)
    return null
  }
  if (!data) return null

  // 2. Load core fields registry
  const core = await loadCoreFields(moduleSlug, formType)

  // 3. Resolve options in both core and custom specs, in parallel
  const schemaDoc = data.schema_definition as FormSchemaDefinitionDoc
  const [resolvedCore, resolvedCustom] = await Promise.all([
    resolveOptions(core.coreFieldsRenderSpec, supabase),
    resolveOptions(schemaDoc.sections, supabase),
  ])

  // 4. Merge with core marked locked
  const sections = [...markLocked(resolvedCore), ...resolvedCustom]

  return {
    schema: {
      moduleSlug,
      formType,
      version: data.version,
      sections,
    },
    formSchemaId: data.id,
    coreFieldsDbColumns: core.coreFieldsDbColumns,
    coreFieldsZodSchema: core.coreFieldsZodSchema,
  }
}

/**
 * Load a historical form_schema version from form_schema_history. Used by FormDetail
 * to render a submission against the schema it was filed under, not the current one.
 */
export async function loadHistoricalFormSchema(
  moduleSlug: string,
  formType: string | null,
  version: number,
): Promise<ResolvedFormSchema | null> {
  const supabase = await createClient()

  const query = supabase
    .from('form_schema_history')
    .select('schema_definition, version')
    .eq('module_slug', moduleSlug)
    .eq('version', version)

  const { data, error } = formType
    ? await query.eq('form_type', formType).maybeSingle()
    : await query.is('form_type', null).maybeSingle()

  if (error) {
    console.error('loadHistoricalFormSchema: query error', error)
    return null
  }
  if (!data) {
    // If the version we want is the CURRENT one (most common case on first render),
    // history doesn't have a row until after a re-publish. Fall back to form_schemas.
    return loadCurrentAtVersion(moduleSlug, formType, version, supabase)
  }

  const core = await loadCoreFields(moduleSlug, formType)
  const schemaDoc = data.schema_definition as FormSchemaDefinitionDoc
  const [resolvedCore, resolvedCustom] = await Promise.all([
    resolveOptions(core.coreFieldsRenderSpec, supabase),
    resolveOptions(schemaDoc.sections, supabase),
  ])

  return {
    moduleSlug,
    formType,
    version: data.version,
    sections: [...markLocked(resolvedCore), ...resolvedCustom],
  }
}

async function loadCurrentAtVersion(
  moduleSlug: string,
  formType: string | null,
  version: number,
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ResolvedFormSchema | null> {
  const query = supabase
    .from('form_schemas')
    .select('schema_definition, version')
    .eq('module_slug', moduleSlug)
    .eq('version', version)

  const { data } = formType
    ? await query.eq('form_type', formType).maybeSingle()
    : await query.is('form_type', null).maybeSingle()

  if (!data) return null

  const core = await loadCoreFields(moduleSlug, formType)
  const schemaDoc = data.schema_definition as FormSchemaDefinitionDoc
  const [resolvedCore, resolvedCustom] = await Promise.all([
    resolveOptions(core.coreFieldsRenderSpec, supabase),
    resolveOptions(schemaDoc.sections, supabase),
  ])

  return {
    moduleSlug,
    formType,
    version: data.version,
    sections: [...markLocked(resolvedCore), ...resolvedCustom],
  }
}
