import 'server-only'

import { requireAdmin } from '@/lib/admin/require-admin'
import { createClient } from '@/lib/supabase/server'

import { loadCoreFields } from './load-core-fields'
import { validateFormSchema } from './meta-schema'
import {
  publishFormSchema,
  discardFormSchemaDraft,
  saveFormSchemaDraft,
} from './publish'
import {
  buildProtectedKeys,
  collectFieldKeys,
  enforceKeyImmutability,
} from './key-immutability'
import {
  KNOWN_RESOURCE_TYPES,
  type EditorDiscardResult,
  type EditorLoadResult,
  type EditorPublishResult,
  type EditorSaveResult,
  type EditorValidateResult,
} from './editor-types'
import type { FormSchemaDefinitionDoc } from './types'

/**
 * Schema-editor contract. Every export here is called via a thin `'use server'`
 * wrapper from Agent 6's admin UI. Do not import this module into a client
 * component — the `'server-only'` marker will trip.
 *
 * Authorization: every action checks `has_module_access('admin_control_center',
 * 'admin')` up-front via the shared `requireAdmin` gate. The underlying RPCs
 * repeat the check (defense in depth + direct-caller protection), so a bug in
 * this file cannot escalate an unprivileged user. RLS is the outermost layer.
 */

// ─────────────────────────────────────────────────────────────────────────────
// loadFormSchemaForEditor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load the raw (unresolved) published + draft schema for the editor, plus the
 * annotations Agent 6's UI needs to render locked cores, autocomplete option
 * list slugs, and block renames of previously-published field keys.
 *
 * Returns the wire format untouched — `from_option_list` / `from_resource_type`
 * references are NOT resolved here. The editor renders the references directly
 * so the admin can see which source a field binds to.
 */
export async function loadFormSchemaForEditor(args: {
  moduleSlug: string
  formType: string | null
}): Promise<EditorLoadResult> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate

  const supabase = await createClient()

  // 1. Current row (published + draft + version)
  const rowQuery = supabase
    .from('form_schemas')
    .select('id, module_slug, form_type, schema_definition, draft_definition, version')
    .eq('module_slug', args.moduleSlug)

  const { data: row, error: rowErr } = args.formType
    ? await rowQuery.eq('form_type', args.formType).maybeSingle()
    : await rowQuery.is('form_type', null).maybeSingle()

  if (rowErr) return { ok: false, error: rowErr.message }
  if (!row) {
    return {
      ok: false,
      error: `No form_schema row for module "${args.moduleSlug}"${
        args.formType ? `, form_type "${args.formType}"` : ''
      }. A row is seeded at facility creation via createFacilityWithFirstAdmin.`,
    }
  }

  // 2. History (for the protected-keys union)
  const histQuery = supabase
    .from('form_schema_history')
    .select('schema_definition')
    .eq('module_slug', args.moduleSlug)

  const { data: hist, error: histErr } = args.formType
    ? await histQuery.eq('form_type', args.formType)
    : await histQuery.is('form_type', null)

  if (histErr) return { ok: false, error: histErr.message }

  // 3. Core field keys (throws if the module is missing core-fields.ts — that's
  //    a developer error, surface it to the admin UI rather than silently
  //    hiding it, so the misconfiguration gets fixed.)
  let coreFieldKeys: string[]
  try {
    const core = await loadCoreFields(args.moduleSlug, args.formType)
    const keys = new Set<string>()
    for (const section of core.coreFieldsRenderSpec) {
      for (const field of section.fields) keys.add(field.key)
    }
    coreFieldKeys = Array.from(keys)
  } catch (err) {
    return {
      ok: false,
      error: `Failed to load core-fields for this module: ${
        err instanceof Error ? err.message : String(err)
      }`,
    }
  }

  // 4. Available option list slugs (facility-scoped by RLS)
  const { data: lists, error: listsErr } = await supabase
    .from('option_lists')
    .select('slug')
    .order('slug', { ascending: true })

  if (listsErr) return { ok: false, error: listsErr.message }

  const published = row.schema_definition as FormSchemaDefinitionDoc
  const draft = (row.draft_definition as FormSchemaDefinitionDoc | null) ?? null
  const historyDocs = (hist ?? []).map(
    (h) => h.schema_definition as FormSchemaDefinitionDoc,
  )

  const protectedKeys = buildProtectedKeys(published, historyDocs)

  return {
    ok: true,
    schemaId: row.id,
    moduleSlug: row.module_slug,
    formType: row.form_type,
    published,
    draft,
    version: row.version,
    annotations: {
      coreFieldKeys,
      protectedKeys: Array.from(protectedKeys),
      availableOptionListSlugs: (lists ?? []).map((l) => l.slug),
      availableResourceTypes: [...KNOWN_RESOURCE_TYPES],
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// validateDraft (pure — no writes, no admin gate; read-only on facility scope)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a candidate draft without writing. If `schemaId` is provided, the
 * key-immutability check runs against that row's published + history keys.
 * Without `schemaId`, only meta-schema validation runs.
 *
 * Called from Agent 6's live editor to surface problems as the admin types.
 * No admin gate — validation reveals no secrets, and requiring the gate would
 * double the RPC cost of every keystroke-driven validate call.
 */
export async function validateDraft(args: {
  draftDefinition: unknown
  schemaId?: string
}): Promise<EditorValidateResult> {
  const metaResult = validateFormSchema(args.draftDefinition)
  if (!metaResult.ok) {
    return { ok: false, validationErrors: metaResult.errors }
  }

  if (!args.schemaId) return { ok: true }

  const supabase = await createClient()
  const { data: row, error: rowErr } = await supabase
    .from('form_schemas')
    .select('module_slug, form_type, schema_definition')
    .eq('id', args.schemaId)
    .maybeSingle()

  if (rowErr) return { ok: false, validationErrors: [{ path: '', message: rowErr.message }] }
  if (!row) {
    return {
      ok: false,
      validationErrors: [{ path: '', message: 'form_schema not found or not accessible' }],
    }
  }

  const histQuery = supabase
    .from('form_schema_history')
    .select('schema_definition')
    .eq('module_slug', row.module_slug)

  const { data: hist } = row.form_type
    ? await histQuery.eq('form_type', row.form_type)
    : await histQuery.is('form_type', null)

  const protectedKeys = buildProtectedKeys(
    row.schema_definition as FormSchemaDefinitionDoc,
    (hist ?? []).map((h) => h.schema_definition as FormSchemaDefinitionDoc),
  )

  const keyErrors = enforceKeyImmutability(metaResult.value, protectedKeys)
  if (keyErrors.length > 0) {
    return { ok: false, keyImmutabilityErrors: keyErrors }
  }

  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// saveDraft (writes draft_definition after full validation)
// ─────────────────────────────────────────────────────────────────────────────

export async function saveDraft(args: {
  schemaId: string
  draftDefinition: unknown
}): Promise<EditorSaveResult> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate

  const metaResult = validateFormSchema(args.draftDefinition)
  if (!metaResult.ok) {
    return {
      ok: false,
      error: 'Draft did not pass meta-schema validation',
      validationErrors: metaResult.errors,
    }
  }

  // Key-immutability check. Load published + history once and compute the
  // protected set in TS. Seam 1 intentionally keeps this at the TS layer;
  // a DB trigger on form_schemas.draft_definition is tracked as a hardening
  // follow-up (KNOWN_GAPS.md).
  const supabase = await createClient()
  const { data: row, error: rowErr } = await supabase
    .from('form_schemas')
    .select('module_slug, form_type, schema_definition')
    .eq('id', args.schemaId)
    .maybeSingle()

  if (rowErr) return { ok: false, error: rowErr.message }
  if (!row) return { ok: false, error: 'form_schema not found or not accessible' }

  const histQuery = supabase
    .from('form_schema_history')
    .select('schema_definition')
    .eq('module_slug', row.module_slug)

  const { data: hist, error: histErr } = row.form_type
    ? await histQuery.eq('form_type', row.form_type)
    : await histQuery.is('form_type', null)

  if (histErr) return { ok: false, error: histErr.message }

  const protectedKeys = buildProtectedKeys(
    row.schema_definition as FormSchemaDefinitionDoc,
    (hist ?? []).map((h) => h.schema_definition as FormSchemaDefinitionDoc),
  )

  const keyErrors = enforceKeyImmutability(metaResult.value, protectedKeys)
  if (keyErrors.length > 0) {
    return {
      ok: false,
      error: 'Draft removes or renames a previously-published field key',
      keyImmutabilityErrors: keyErrors,
    }
  }

  // Delegate to existing RPC-backed saveFormSchemaDraft. It re-runs
  // meta-schema validation (belt + suspenders) and enforces RLS/admin.
  const saveResult = await saveFormSchemaDraft(args.schemaId, args.draftDefinition)
  if (!saveResult.ok) {
    return {
      ok: false,
      error: saveResult.error,
      validationErrors: saveResult.validationErrors,
    }
  }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// publishDraft (thin wrapper — harmonized result shape)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Harmonizer over publishFormSchema. Runs the key-immutability check against
 * the draft_definition before delegating to the RPC. The RPC-side meta-schema
 * re-validation is already in lib/forms/publish.ts; we add the key-immutability
 * gate so a publish never bypasses a saveDraft-level check (e.g. if the draft
 * was saved before this rule existed and is now being published unchanged).
 */
export async function publishDraft(args: {
  schemaId: string
}): Promise<EditorPublishResult> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate

  const supabase = await createClient()
  const { data: row, error: rowErr } = await supabase
    .from('form_schemas')
    .select('module_slug, form_type, schema_definition, draft_definition')
    .eq('id', args.schemaId)
    .maybeSingle()

  if (rowErr) return { ok: false, error: rowErr.message }
  if (!row) return { ok: false, error: 'form_schema not found or not accessible' }
  if (!row.draft_definition) return { ok: false, error: 'No draft to publish' }

  // Re-validate the draft (defense in depth; publishFormSchema also does this)
  const metaResult = validateFormSchema(row.draft_definition)
  if (!metaResult.ok) {
    return {
      ok: false,
      error: 'Draft did not pass meta-schema validation',
      validationErrors: metaResult.errors,
    }
  }

  // Key-immutability vs. history + currently-published
  const histQuery = supabase
    .from('form_schema_history')
    .select('schema_definition')
    .eq('module_slug', row.module_slug)

  const { data: hist, error: histErr } = row.form_type
    ? await histQuery.eq('form_type', row.form_type)
    : await histQuery.is('form_type', null)

  if (histErr) return { ok: false, error: histErr.message }

  const protectedKeys = buildProtectedKeys(
    row.schema_definition as FormSchemaDefinitionDoc,
    (hist ?? []).map((h) => h.schema_definition as FormSchemaDefinitionDoc),
  )

  const keyErrors = enforceKeyImmutability(metaResult.value, protectedKeys)
  if (keyErrors.length > 0) {
    return {
      ok: false,
      error: 'Cannot publish: draft removes or renames a previously-published field key',
      keyImmutabilityErrors: keyErrors,
    }
  }

  const result = await publishFormSchema(args.schemaId)
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      validationErrors: result.validationErrors,
    }
  }
  return {
    ok: true,
    new_version: result.new_version,
    published_at: result.published_at,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// discardDraft (thin wrapper)
// ─────────────────────────────────────────────────────────────────────────────

export async function discardDraft(args: {
  schemaId: string
}): Promise<EditorDiscardResult> {
  const gate = await requireAdmin()
  if (!gate.ok) return gate

  const result = await discardFormSchemaDraft(args.schemaId)
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports for editor callers
// ─────────────────────────────────────────────────────────────────────────────

// Useful when an editor caller wants to walk a schema doc alongside our own
// utilities without importing multiple files.
export { collectFieldKeys } from './key-immutability'
