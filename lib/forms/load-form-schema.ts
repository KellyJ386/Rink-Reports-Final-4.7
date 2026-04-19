import 'server-only'

import { createClient } from '@/lib/supabase/server'

import { loadCoreFields, markLocked } from './load-core-fields'
import { resolveOptions } from './resolve-options'
import type {
  FieldSpec,
  FormSchemaDefinitionDoc,
  OptionSource,
  ResolvedFormSchema,
  ResolvedSectionSpec,
  SectionSpec,
} from './types'

/**
 * Why a field cannot be filled. Surfaced to admins, not end users — staff should
 * never see a form where a required field has no answerable options.
 */
export type RenderError = {
  fieldKey: string
  fieldLabel: string
  reason: 'option_list_empty' | 'option_list_missing' | 'resource_type_empty'
  sourceRef: string // slug or resource_type
  adminAction: string
  adminPath: string
}

export type LoadedFormSchema = {
  schema: ResolvedFormSchema
  formSchemaId: string
  coreFieldsDbColumns: string[]
  coreFieldsZodSchema: unknown
  /** Empty when all required fields are fillable. Non-empty means the page should
   *  render an admin-facing error instead of the form. */
  renderErrors: RenderError[]
}

/**
 * Load and resolve the published form_schema for (moduleSlug, formType) scoped to
 * the caller's facility via RLS. Returns a fully-resolved structure ready for
 * <DynamicForm /> — OR a list of renderErrors when required fields reference
 * empty/missing option sources.
 */
export async function loadPublishedFormSchema(
  moduleSlug: string,
  formType: string | null,
): Promise<LoadedFormSchema | null> {
  const supabase = await createClient()

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

  const core = await loadCoreFields(moduleSlug, formType)
  const schemaDoc = data.schema_definition as FormSchemaDefinitionDoc

  const [resolvedCore, resolvedCustom] = await Promise.all([
    resolveOptions(core.coreFieldsRenderSpec, supabase),
    resolveOptions(schemaDoc.sections, supabase),
  ])

  const sections = [...markLocked(resolvedCore), ...resolvedCustom]

  // Detect render errors: required select/radio/multiselect fields whose resolved
  // options are empty. We check across both core and custom, pairing resolved
  // results with the original (unresolved) specs so we know whether the source was
  // an option list, a resource type, or a list we can't distinguish as missing.
  const renderErrors: RenderError[] = [
    ...detectRenderErrors(core.coreFieldsRenderSpec, resolvedCore),
    ...detectRenderErrors(schemaDoc.sections, resolvedCustom),
  ]

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
    renderErrors,
  }
}

function detectRenderErrors(
  original: SectionSpec[],
  resolved: ResolvedSectionSpec[],
): RenderError[] {
  const errors: RenderError[] = []

  for (let i = 0; i < original.length; i++) {
    const origSection = original[i]
    const resSection = resolved[i]
    if (!origSection || !resSection) continue

    for (let j = 0; j < origSection.fields.length; j++) {
      const origField = origSection.fields[j]
      const resField = resSection.fields[j]
      if (!origField || !resField) continue

      if (!origField.required) continue
      if (origField.type !== 'select' && origField.type !== 'radio' && origField.type !== 'multiselect') continue

      const src = (origField as FieldSpec & { options: OptionSource }).options
      if (Array.isArray(src)) continue // inline options can't be empty through config; meta-schema enforces .min(1)

      const resolvedOpts = (resField as { options?: unknown }).options
      const isEmpty = !Array.isArray(resolvedOpts) || resolvedOpts.length === 0
      if (!isEmpty) continue

      if ('from_option_list' in src) {
        errors.push({
          fieldKey: origField.key,
          fieldLabel: origField.label,
          reason: 'option_list_empty',
          sourceRef: src.from_option_list,
          adminAction: `Create option list "${src.from_option_list}" and add at least one active item.`,
          adminPath: '/admin/option-lists',
        })
      } else if ('from_resource_type' in src) {
        errors.push({
          fieldKey: origField.key,
          fieldLabel: origField.label,
          reason: 'resource_type_empty',
          sourceRef: src.from_resource_type,
          adminAction: `Add at least one active ${friendlyResourceTypeName(src.from_resource_type)} in Resources.`,
          adminPath: '/admin/resources',
        })
      }
    }
  }

  return errors
}

function friendlyResourceTypeName(type: string): string {
  switch (type) {
    case 'surface':
      return 'ice surface'
    case 'compressor':
      return 'compressor'
    case 'zamboni':
      return 'zamboni'
    case 'air_quality_device':
      return 'air quality device'
    case 'shift_position':
      return 'shift position'
    default:
      return type.replace(/_/g, ' ')
  }
}

/**
 * Load a historical form_schema version from form_schema_history. Used by FormDetail
 * to render a submission against the schema it was filed under, not the current one.
 *
 * Does not compute renderErrors — detail view renders from the snapshotted labels in
 * custom_fields.__label_snapshot and from the known row data, not from live options.
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
