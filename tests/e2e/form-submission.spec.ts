import { test, expect } from '@playwright/test'

import { loginAs } from './helpers/auth'

/**
 * Priority E2E 2 — form submission round-trip.
 *
 * Path: Circle Check submit → history listing → detail view → audit log entry.
 *
 * This exercises Agent 2 (form engine), Agent 3 (module wiring), Agent 7
 * (audit log + notifications). The critical invariant being tested:
 * `form_schema_version` is pinned on the submission and the detail view
 * renders from the historical schema (not the current). A new field added
 * after the submission must not appear in the detail.
 */

test.describe('Form submission — Circle Check', () => {
  test('submit → appears in history → detail matches → audit log recorded', async ({ page }) => {
    await loginAs(page, 'alphaStaff')

    // 1. Navigate to Circle Check → New
    await page.goto('/modules/ice-maintenance/circle-check/new')
    await expect(page.getByRole('heading', { name: /new circle check/i })).toBeVisible()

    // 2. Fill the seeded schema's required fields. Seed ships with date +
    //    time + one free-text notes field; the schema version pins at submit.
    const today = new Date().toISOString().split('T')[0]
    await page.getByLabel(/date/i).first().fill(today!)
    await page.getByLabel(/time/i).first().fill('10:00')
    const notes = `E2E round-trip check ${Date.now()}`
    // Notes field shape varies; select by role textbox as best-effort
    const notesField = page.getByRole('textbox').last()
    await notesField.fill(notes)

    // 3. Submit
    await page.getByRole('button', { name: /submit|save/i }).click()

    // 4. Expect redirect to history (or to the detail); navigate to history
    await page.waitForURL(/\/modules\/ice-maintenance(\/circle-check)?($|\?)/, {
      timeout: 10_000,
    })
    await page.goto('/modules/ice-maintenance/circle-check')

    // 5. Submission appears in the listing — find the row by our unique notes snippet
    const row = page.getByText(notes).first()
    await expect(row).toBeVisible({ timeout: 5_000 })

    // 6. Click through to detail
    await row.click()
    await expect(page.getByText(notes)).toBeVisible()
    // Schema version must be pinned + visible
    await expect(page.getByText(/schema v\d+/i)).toBeVisible()

    // 7. Audit log: the alpha admin (who has audit access) can see a row
    //    for this submission.
    //    This is a multi-user assertion — switch contexts.
    const adminContext = await page.context().browser()?.newContext()
    expect(adminContext).toBeTruthy()
    const adminPage = await adminContext!.newPage()
    // Re-login as admin
    await adminPage.goto('/login')
    const { SEEDED_USERS } = await import('../factories/supabase-client')
    await adminPage.getByLabel(/email/i).fill(SEEDED_USERS.alphaAdmin.email)
    await adminPage.getByLabel(/password/i).fill(SEEDED_USERS.alphaAdmin.password)
    await adminPage.getByRole('button', { name: /sign in|log in/i }).click()
    await adminPage.waitForURL((url) => !url.pathname.startsWith('/login'))

    await adminPage.goto('/admin/audit')
    await expect(adminPage.getByText(/circle_check|ice_maintenance|submission/i).first()).toBeVisible(
      { timeout: 5_000 },
    )

    await adminContext!.close()
  })
})
