import 'server-only'

import { createClient } from '@/lib/supabase/server'

import { buildZodFromSchema } from './build-zod'
import { loadCoreFields } from './load-core-fields'
import { loadPublishedFormSchema } from './load-form-schema'
import { getSubmissionTable } from './submission-tables'
import type { InlineOption, ResolvedFieldSpec } from './types'

export type SubmitFormInput = {
  moduleSlug: string
  formType: string | null
  values: Record<string, unknown>
  /** Client-generated uuid. Same key on retry → same row (idempotent). */
  idempotencyKey?: string
}

export type SubmitFormResult =
  | { ok: true; id: string; idempotentReturn: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

/**
 * Write a submission. Shared entry point for every form-engine-driven module.
 *
 * Flow:
 *   1. Load resolved form schema (core + custom, options resolved).
 *   2. Load core-fields Zod + db column list.
 *   3. Build combined Zod (coreFieldsZodSchema + custom schema from buildZodFromSchema).
 *   4. Validate. Return field errors if any.
 *   5. Snapshot resolved option labels into the submission payload (so historical
 *      detail views still render labels correctly even if admins rename options).
 *   6. Partition validated values: core columns vs. custom_fields jsonb.
 *   7. Insert with idempotency handling; re-select on conflict.
 *   8. Audit log.
 */
export async function submitForm(input: SubmitFormInput): Promise<SubmitFormResult> {
  const supabase = await createClient()

  // Auth check (middleware should already catch this, but be defensive)
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !user) {
    return { ok: false, error: 'Not authenticated' }
  }

  // 1. Load schema + core
  const loaded = await loadPublishedFormSchema(input.moduleSlug, input.formType)
  if (!loaded) {
    return { ok: false, error: `Form schema for ${input.moduleSlug}/${input.formType ?? '—'} not found` }
  }
  const { schema, coreFieldsDbColumns, coreFieldsZodSchema } = loaded

  // 3. Build combined Zod
  // Keep core and custom separate; union-compose at validation time.
  const customZod = buildZodFromSchema(schema.sections.filter((s) => !s.locked))
  // The core-fields Zod is authored per module and may use refinements we can't merge
  // mechanically; validate separately then combine.
  const coreResult = (coreFieldsZodSchema as import('zod').ZodTypeAny).safeParse(input.values)
  const customResult = customZod.safeParse(input.values)

  if (!coreResult.success || !customResult.success) {
    const fieldErrors: Record<string, string> = {}
    if (!coreResult.success) {
      for (const issue of coreResult.error.issues) {
        fieldErrors[issue.path.join('.')] = issue.message
      }
    }
    if (!customResult.success) {
      for (const issue of customResult.error.issues) {
        fieldErrors[issue.path.join('.')] = issue.message
      }
    }
    return { ok: false, error: 'Validation failed', fieldErrors }
  }

  // 5. Snapshot option labels
  const snapshots = snapshotOptionLabels(input.values, schema.sections)

  // 6. Partition
  const { coreData, customData } = partitionFields(
    { ...input.values, ...snapshots },
    coreFieldsDbColumns,
  )

  // 7. Insert with idempotency
  const tableConfig = getSubmissionTable(input.moduleSlug)
  const row: Record<string, unknown> = {
    ...coreData,
    form_schema_version: schema.version,
    custom_fields: customData,
    submitted_by: user.id,
    idempotency_key: input.idempotencyKey ?? null,
  }
  if (tableConfig.hasFormTypeColumn) {
    if (!input.formType) {
      return { ok: false, error: `Module ${input.moduleSlug} requires form_type, none provided` }
    }
    row.form_type = input.formType
  }

  // First attempt: plain insert. If it conflicts on idempotency_key, we re-select.
  const { data: inserted, error: insertError } = await supabase
    .from(tableConfig.tableName)
    .insert(row)
    .select('id')
    .maybeSingle()

  if (insertError) {
    // Detect unique violation on idempotency index (Postgres SQLSTATE 23505)
    // Supabase error.code typically populated; the JS client maps details into error.message.
    if (input.idempotencyKey && insertError.code === '23505') {
      return selectExistingByIdempotency(supabase, tableConfig.tableName, input.idempotencyKey)
    }
    return { ok: false, error: insertError.message }
  }

  if (!inserted) {
    // Shouldn't happen on a successful insert; treat as unknown
    return { ok: false, error: 'Insert succeeded but no row returned' }
  }

  // 8. Audit (best-effort; don't fail the submit on audit failure)
  const auditFacility = await facilityForSubmission(supabase, tableConfig.tableName, inserted.id)
  if (auditFacility) {
    const { error: auditError } = await supabase.from('audit_log').insert({
      facility_id: auditFacility,
      actor_user_id: user.id,
      action: 'submission.created',
      entity_type: tableConfig.tableName,
      entity_id: inserted.id,
      metadata: {
        module_slug: input.moduleSlug,
        form_type: input.formType,
        form_schema_version: schema.version,
      },
    })
    if (auditError) console.error('submitForm: audit write failed', auditError)
  }

  return { ok: true, id: inserted.id, idempotentReturn: false }
}

async function selectExistingByIdempotency(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tableName: string,
  idempotencyKey: string,
): Promise<SubmitFormResult> {
  const { data, error } = await supabase
    .from(tableName)
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (error || !data) {
    return { ok: false, error: 'Idempotency conflict but no prior row found' }
  }
  return { ok: true, id: data.id, idempotentReturn: true }
}

async function facilityForSubmission(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tableName: string,
  rowId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from(tableName)
    .select('facility_id')
    .eq('id', rowId)
    .maybeSingle()
  return (data as { facility_id?: string } | null)?.facility_id ?? null
}

function partitionFields(
  values: Record<string, unknown>,
  coreColumns: string[],
): { coreData: Record<string, unknown>; customData: Record<string, unknown> } {
  const coreSet = new Set(coreColumns)
  const coreData: Record<string, unknown> = {}
  const customData: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    if (coreSet.has(k)) coreData[k] = v
    else if (k !== '__label_snapshot') customData[k] = v
  }
  // Attach label snapshots to custom_fields under a reserved namespace
  if (values.__label_snapshot) {
    customData.__label_snapshot = values.__label_snapshot
  }
  return { coreData, customData }
}

/**
 * For every field whose options resolve to {key,label} pairs, snapshot the selected
 * label(s) alongside the submitted key(s). Stored under `custom_fields.__label_snapshot`
 * so a renamed or deactivated option still reads its historical display value.
 *
 * Single select / radio: { [field_key]: "optionLabelAtSubmit" }
 * Multiselect:           { [field_key]: ["label1","label2"] }
 */
function snapshotOptionLabels(
  values: Record<string, unknown>,
  sections: Array<{ fields: Array<ResolvedFieldSpec | { type: string; key: string; options?: unknown }> }>,
): Record<string, unknown> {
  const snapshot: Record<string, string | string[]> = {}

  for (const section of sections) {
    for (const field of section.fields) {
      if (field.type !== 'select' && field.type !== 'radio' && field.type !== 'multiselect') continue
      const options = (field as { options: unknown }).options
      if (!Array.isArray(options)) continue
      const inline = options as InlineOption[]
      const byKey = new Map(inline.map((o) => [o.key, o.label]))

      const v = values[field.key]
      if (field.type === 'multiselect' && Array.isArray(v)) {
        snapshot[field.key] = v.map((k) => byKey.get(String(k)) ?? String(k))
      } else if (typeof v === 'string') {
        const label = byKey.get(v)
        if (label) snapshot[field.key] = label
      }
    }
  }

  return Object.keys(snapshot).length > 0 ? { __label_snapshot: snapshot } : {}
}
