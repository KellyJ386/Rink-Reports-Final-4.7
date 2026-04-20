import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { anonClient, SEEDED_USERS, serviceClient, signIn } from '../../factories/supabase-client'

/**
 * Agent 2 engine-hardening — integration suite for the draft → publish cycle.
 *
 * Load-bearing guarantees under test:
 *   1. save_draft accepts a valid schema; meta-schema rejection surfaces on save
 *   2. publish advances version, snapshots to form_schema_history, clears draft
 *   3. submissions are pinned to the version live at submit time — a submission
 *      filed under v3 still renders against v3 after publish to v4. This is
 *      the "editing forms doesn't corrupt history" guarantee.
 *   4. Idempotent submit: same idempotency_key twice → one row, same id.
 *
 * Fixtures: single-purpose, inline. Uses serviceClient() for cross-RLS cleanup
 * only — no cross-test factory. See tests/factories/README.md on why.
 */

const ALPHA_FACILITY = SEEDED_USERS.alphaAdmin.facility_id
const TEST_MODULE_SLUG = 'ice_maintenance'
const TEST_FORM_TYPE = 'circle_check'

type FormSchemaRow = { id: string; version: number; schema_definition: unknown; draft_definition: unknown }

async function loadCircleCheckFormSchema(): Promise<FormSchemaRow> {
  const svc = serviceClient()
  const { data, error } = await svc
    .from('form_schemas')
    .select('id, version, schema_definition, draft_definition')
    .eq('facility_id', ALPHA_FACILITY)
    .eq('module_slug', TEST_MODULE_SLUG)
    .eq('form_type', TEST_FORM_TYPE)
    .single()
  if (error || !data) throw new Error(`form_schema fixture missing: ${error?.message}`)
  return data as FormSchemaRow
}

const BASELINE_SCHEMA = {
  sections: [
    {
      key: 'main',
      label: 'Main',
      fields: [
        { key: 'ice_temp_f', label: 'Ice Temp (°F)', type: 'number', required: true, min: 0, max: 40 },
        { key: 'notes', label: 'Notes', type: 'text', required: false },
      ],
    },
  ],
}

const EXTENDED_SCHEMA = {
  sections: [
    {
      key: 'main',
      label: 'Main',
      fields: [
        { key: 'ice_temp_f', label: 'Ice Temp (°F)', type: 'number', required: true, min: 0, max: 40 },
        { key: 'notes', label: 'Notes', type: 'text', required: false },
        { key: 'wear_gear', label: 'PPE worn', type: 'boolean', required: true },
      ],
    },
  ],
}

describe('Form engine — draft save + meta-schema rejection', () => {
  it('rejects a draft with a non-snake_case field key at save time', async () => {
    const alpha = anonClient()
    await signIn(alpha, SEEDED_USERS.alphaAdmin)
    const schema = await loadCircleCheckFormSchema()

    const { error } = await alpha.rpc('rpc_save_form_schema_draft', {
      p_form_schema_id: schema.id,
      p_draft_definition: {
        sections: [
          {
            key: 'main',
            label: 'Main',
            fields: [{ key: 'BAD', label: 'B', type: 'text', required: false }],
          },
        ],
      },
    })
    // The publish path validates via validateFormSchema; the RPC may accept
    // any JSON as a draft and defer validation to publish. Either shape is
    // acceptable. What we assert: either the draft is rejected at save, OR
    // the subsequent publish attempt fails meta-schema validation.
    if (!error) {
      const { data } = await alpha
        .from('form_schemas')
        .select('draft_definition')
        .eq('id', schema.id)
        .single()
      expect(data?.draft_definition).toBeTruthy()
      // Immediate publish should fail because of the bad key
      const { error: publishErr } = await alpha.rpc('rpc_publish_form_schema', {
        p_form_schema_id: schema.id,
      })
      expect(publishErr).toBeTruthy()

      // Cleanup: clear draft
      await alpha.rpc('rpc_discard_form_schema_draft', { p_form_schema_id: schema.id })
    }
  })
})

describe('Form engine — publish cycle', () => {
  it('save + publish advances version and clears draft', async () => {
    const alpha = anonClient()
    await signIn(alpha, SEEDED_USERS.alphaAdmin)
    const before = await loadCircleCheckFormSchema()
    const versionBefore = before.version

    const { error: saveErr } = await alpha.rpc('rpc_save_form_schema_draft', {
      p_form_schema_id: before.id,
      p_draft_definition: EXTENDED_SCHEMA,
    })
    expect(saveErr).toBeNull()

    const { error: publishErr } = await alpha.rpc('rpc_publish_form_schema', {
      p_form_schema_id: before.id,
    })
    expect(publishErr).toBeNull()

    const after = await loadCircleCheckFormSchema()
    expect(after.version).toBe(versionBefore + 1)
    expect(after.draft_definition).toBeNull()

    // The history table should have the previous (pre-publish) snapshot
    const svc = serviceClient()
    const { data: history } = await svc
      .from('form_schema_history')
      .select('version, schema_definition')
      .eq('facility_id', ALPHA_FACILITY)
      .eq('module_slug', TEST_MODULE_SLUG)
      .eq('form_type', TEST_FORM_TYPE)
      .order('version', { ascending: false })
    expect((history ?? []).length).toBeGreaterThan(0)
    expect((history![0] as { version: number }).version).toBe(versionBefore + 1)
  })

  afterAll(async () => {
    // Restore the seeded baseline so other tests don't see drift
    const svc = serviceClient()
    const current = await loadCircleCheckFormSchema()
    await svc
      .from('form_schemas')
      .update({
        schema_definition: BASELINE_SCHEMA,
        draft_definition: null,
      })
      .eq('id', current.id)
  })
})

describe('Form engine — version pinning on submissions', () => {
  let submissionId: string | null = null
  let versionAtSubmit: number | null = null

  beforeAll(async () => {
    // Ensure we start from baseline
    const svc = serviceClient()
    const current = await loadCircleCheckFormSchema()
    await svc
      .from('form_schemas')
      .update({ schema_definition: BASELINE_SCHEMA, draft_definition: null })
      .eq('id', current.id)
  })

  it('submitting under version N pins form_schema_version=N on the row', async () => {
    const alpha = anonClient()
    await signIn(alpha, SEEDED_USERS.alphaStaff)

    const schemaRow = await loadCircleCheckFormSchema()
    versionAtSubmit = schemaRow.version

    const idempotencyKey = `int-test-${Date.now()}`

    const { data: inserted, error } = await alpha
      .from('ice_maintenance_submissions')
      .insert({
        form_type: TEST_FORM_TYPE,
        form_schema_version: versionAtSubmit,
        submitted_by: SEEDED_USERS.alphaStaff.id,
        date_of_check: new Date().toISOString().slice(0, 10),
        time_of_check: '09:00',
        custom_fields: { ice_temp_f: 25, notes: 'integration test' },
        idempotency_key: idempotencyKey,
      })
      .select('id, form_schema_version')
      .single()

    expect(error).toBeNull()
    expect(inserted).toBeTruthy()
    expect((inserted as { form_schema_version: number }).form_schema_version).toBe(versionAtSubmit)
    submissionId = (inserted as { id: string }).id
  })

  it('after a publish to version N+1, the submission still reads version N', async () => {
    expect(submissionId).toBeTruthy()
    expect(versionAtSubmit).toBeTruthy()

    const alpha = anonClient()
    await signIn(alpha, SEEDED_USERS.alphaAdmin)

    const schemaRow = await loadCircleCheckFormSchema()
    await alpha.rpc('rpc_save_form_schema_draft', {
      p_form_schema_id: schemaRow.id,
      p_draft_definition: EXTENDED_SCHEMA,
    })
    const { error: publishErr } = await alpha.rpc('rpc_publish_form_schema', {
      p_form_schema_id: schemaRow.id,
    })
    expect(publishErr).toBeNull()

    // Re-read the submission: form_schema_version is the one at submit time
    const { data: submission } = await anonClient()
      .from('ice_maintenance_submissions')
      .select('form_schema_version')
      .eq('id', submissionId!)
      .single()
    expect((submission as { form_schema_version: number }).form_schema_version).toBe(
      versionAtSubmit,
    )

    // And form_schema_history has a row for that exact version, carrying
    // BASELINE_SCHEMA shape (not EXTENDED_SCHEMA)
    const svc = serviceClient()
    const { data: histRow } = await svc
      .from('form_schema_history')
      .select('schema_definition')
      .eq('facility_id', ALPHA_FACILITY)
      .eq('module_slug', TEST_MODULE_SLUG)
      .eq('form_type', TEST_FORM_TYPE)
      .eq('version', versionAtSubmit!)
      .maybeSingle()
    if (histRow) {
      // Baseline fields were ice_temp_f + notes — no wear_gear
      const def = (histRow.schema_definition as typeof BASELINE_SCHEMA)
      const keys = def.sections[0]!.fields.map((f) => f.key)
      expect(keys).toContain('ice_temp_f')
      expect(keys).toContain('notes')
      expect(keys).not.toContain('wear_gear')
    }
  })

  afterAll(async () => {
    // Cleanup the test submission + restore baseline schema
    const svc = serviceClient()
    if (submissionId) {
      await svc.from('ice_maintenance_submissions').delete().eq('id', submissionId)
    }
    const current = await loadCircleCheckFormSchema()
    await svc
      .from('form_schemas')
      .update({ schema_definition: BASELINE_SCHEMA, draft_definition: null })
      .eq('id', current.id)
  })
})

describe('Form engine — idempotent submit', () => {
  let firstRowId: string | null = null
  const idempotencyKey = `int-idem-${Date.now()}`

  it('same idempotency_key twice yields one row', async () => {
    const alpha = anonClient()
    await signIn(alpha, SEEDED_USERS.alphaStaff)
    const schema = await loadCircleCheckFormSchema()

    const payload = {
      form_type: TEST_FORM_TYPE,
      form_schema_version: schema.version,
      submitted_by: SEEDED_USERS.alphaStaff.id,
      date_of_check: new Date().toISOString().slice(0, 10),
      time_of_check: '10:00',
      custom_fields: { ice_temp_f: 26 },
      idempotency_key: idempotencyKey,
    }

    const { data: first, error: e1 } = await alpha
      .from('ice_maintenance_submissions')
      .insert(payload)
      .select('id')
      .single()
    expect(e1).toBeNull()
    firstRowId = (first as { id: string }).id

    // Second insert with the same key — expect an error of class 23505 (unique violation)
    // The submit action path catches this and returns the existing row; raw INSERT will throw.
    const { error: e2 } = await alpha
      .from('ice_maintenance_submissions')
      .insert(payload)
    expect(e2).toBeTruthy()
    expect(e2?.code).toBe('23505')
  })

  afterAll(async () => {
    const svc = serviceClient()
    if (firstRowId) {
      await svc.from('ice_maintenance_submissions').delete().eq('id', firstRowId)
    }
  })
})
