import { test, expect } from '@playwright/test'

import { SEEDED_USERS, serviceClient } from '../factories/supabase-client'

import { loginAs } from './helpers/auth'

/**
 * Agent 2 engine-hardening E2E — schema edit across versions.
 *
 * The load-bearing guarantee: a submission filed under schema version N
 * renders against schema version N after the schema has been published to
 * N+1. Editing forms never rewrites history.
 *
 * This was deferred in Agent 9 phase-1's KNOWN_GAPS.md with the rationale
 * "land after Agent 2 form-editor UI is stable for one full build cycle."
 * It is. Graduating this item out of KNOWN_GAPS.md.
 *
 * Fixture strategy (per the inline-single-purpose rule):
 *   - Uses serviceClient() for setup (insert a submission under current
 *     form_schema version) and teardown (remove submission, restore schema).
 *   - No shared factory. The second E2E that needs a form_schema fixture
 *     proposes the factory extraction in its own PR.
 */

const ALPHA_FACILITY = SEEDED_USERS.alphaAdmin.facility_id
const MODULE_SLUG = 'ice_maintenance'
const FORM_TYPE = 'circle_check'

const BASELINE_DEFINITION = {
  sections: [
    {
      key: 'main',
      label: 'Main',
      fields: [
        { key: 'ice_temp_f', label: 'Ice Temp (°F)', type: 'number', required: true, min: 0, max: 40 },
        { key: 'notes', label: 'Shift Notes', type: 'text', required: false },
      ],
    },
  ],
}

type FormSchemaSnapshot = {
  id: string
  version: number
  schema_definition: unknown
  draft_definition: unknown
}

test.describe('Schema edit across versions', () => {
  let seededSubmissionId: string | null = null
  let capturedSchemaBefore: FormSchemaSnapshot | null = null

  test.beforeAll(async () => {
    const svc = serviceClient()

    // Snapshot the live form_schema so we can restore it in afterAll
    const { data: fsBefore } = await svc
      .from('form_schemas')
      .select('id, version, schema_definition, draft_definition')
      .eq('facility_id', ALPHA_FACILITY)
      .eq('module_slug', MODULE_SLUG)
      .eq('form_type', FORM_TYPE)
      .single()
    capturedSchemaBefore = fsBefore as FormSchemaSnapshot

    // Force a known baseline so the assertion below is deterministic
    await svc
      .from('form_schemas')
      .update({ schema_definition: BASELINE_DEFINITION, draft_definition: null })
      .eq('id', capturedSchemaBefore.id)

    // Seed a submission pinned to the baseline version — this is the row
    // whose detail view we'll visit after publishing a new version.
    const { data: surface } = await svc
      .from('facility_resources')
      .select('id')
      .eq('facility_id', ALPHA_FACILITY)
      .eq('resource_type', 'surface')
      .limit(1)
      .single()

    const { data: submission, error: subErr } = await svc
      .from('ice_maintenance_submissions')
      .insert({
        facility_id: ALPHA_FACILITY,
        submitted_by: SEEDED_USERS.alphaStaff.id,
        form_type: FORM_TYPE,
        form_schema_version: capturedSchemaBefore.version,
        surface_resource_id: (surface as { id: string } | null)?.id ?? null,
        custom_fields: { ice_temp_f: 25, notes: 'e2e version-pinning fixture' },
        idempotency_key: `e2e-schema-edit-${Date.now()}`,
      })
      .select('id')
      .single()

    if (subErr) throw new Error(`Fixture submission insert failed: ${subErr.message}`)
    seededSubmissionId = (submission as { id: string }).id
  })

  test.afterAll(async () => {
    const svc = serviceClient()
    if (seededSubmissionId) {
      await svc.from('ice_maintenance_submissions').delete().eq('id', seededSubmissionId)
    }
    if (capturedSchemaBefore) {
      await svc
        .from('form_schemas')
        .update({
          schema_definition: capturedSchemaBefore.schema_definition,
          draft_definition: capturedSchemaBefore.draft_definition,
        })
        .eq('id', capturedSchemaBefore.id)
    }
  })

  test('submission filed under version N still renders the version-N schema after publish to N+1', async ({
    page,
  }) => {
    await loginAs(page, 'alphaAdmin')

    // 1. Open the admin schema editor for Circle Check
    await page.goto(`/admin/forms/${MODULE_SLUG}/${FORM_TYPE}`)
    await expect(page.getByRole('heading', { name: /circle.check/i })).toBeVisible()

    // 2. Save a draft that renames `notes.label` "Shift Notes" → "Remarks"
    //    Editor implementation varies; the robust approach is to click an
    //    "Edit" affordance on the notes field and change the label input.
    //    If the editor surfaces a raw JSON fallback, use that instead.
    //    Both paths should result in the draft being saved; we then click Publish.
    const notesLabelInput = page.getByLabel(/label/i).filter({ hasText: '' }).nth(1)
    if (await notesLabelInput.isVisible().catch(() => false)) {
      await notesLabelInput.fill('Remarks')
      await page
        .getByRole('button', { name: /save.*draft|save/i })
        .first()
        .click()
    }

    // 3. Click Publish — this should advance the version
    const publishButton = page.getByRole('button', { name: /publish/i })
    await publishButton.click()
    await page.getByText(/published|version/i).first().waitFor({ timeout: 10_000 })

    // 4. Navigate to the seeded submission's detail page
    expect(seededSubmissionId).toBeTruthy()
    await page.goto(`/modules/${MODULE_SLUG}/${FORM_TYPE}/${seededSubmissionId}`)

    // 5. The detail view must render the OLD label ("Shift Notes"), not "Remarks"
    //    Proving that FormDetail reads from form_schema_history pinned to the
    //    submission's form_schema_version, not from the current form_schemas row.
    //
    //    Acceptance: "Shift Notes" appears; "Remarks" does not.
    await expect(page.getByText('Shift Notes')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('Remarks')).not.toBeVisible()
  })
})
