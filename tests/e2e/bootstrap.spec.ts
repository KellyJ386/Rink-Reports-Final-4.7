import { test, expect } from '@playwright/test'

import { loginAs } from './helpers/auth'

/**
 * Priority E2E 1 — bootstrap.
 *
 * Path covered: platform admin creates a facility → first-admin invite is
 * issued → raw invite URL is surfaced → new admin accepts → password set →
 * new admin lands in the admin shell scoped to the new facility.
 *
 * This exercises the highest-risk cross-agent seam: Agent 1a (schema/RLS),
 * Agent 1b (invite + bootstrap), Agent 6 (admin shell), Agent 7 (session +
 * middleware). If this path breaks, nothing downstream works — which is
 * exactly why it's priority 1.
 */

test.describe('Bootstrap', () => {
  test('platform admin creates facility + first admin, new admin accepts and lands in admin shell', async ({
    page,
  }) => {
    // 1. Platform admin signs in
    await loginAs(page, 'platformAdmin')
    await expect(page).toHaveURL(/\/platform-admin/)

    // 2. Navigate to facilities → new
    await page.goto('/platform-admin/facilities/new')
    await expect(page.getByRole('heading', { name: /new facility/i })).toBeVisible()

    // 3. Fill out the form with unique identifiers so parallel e2e shards don't collide
    const suffix = Math.random().toString(36).slice(2, 8)
    const facilityName = `Test Arena ${suffix}`
    const firstAdminEmail = `admin-${suffix}@rinkreports.test`

    await page.getByLabel(/facility name/i).fill(facilityName)
    await page.getByLabel(/timezone/i).fill('America/Toronto')
    await page.getByLabel(/street/i).fill('100 Test Rd')
    await page.getByLabel(/city/i).fill('Toronto')
    await page.getByLabel(/state|province/i).fill('ON')
    await page.getByLabel(/postal/i).fill('M5A 1A1')
    await page.getByLabel(/first admin email/i).fill(firstAdminEmail)

    await page.getByRole('button', { name: /create facility/i }).click()

    // 4. Invite URL must appear + contain the expected shape
    const inviteLink = page.getByRole('link', { name: /accept-invite/i })
    await expect(inviteLink).toBeVisible({ timeout: 10_000 })
    const inviteHref = await inviteLink.getAttribute('href')
    expect(inviteHref).toMatch(/\/accept-invite\?token=/)

    // 5. New admin opens the invite in a fresh context (no existing session)
    const freshContext = await page.context().browser()?.newContext()
    expect(freshContext).toBeTruthy()
    const newPage = await freshContext!.newPage()
    await newPage.goto(inviteHref!)

    // 6. Accept page asks for name + password
    await expect(newPage.getByRole('heading', { name: /welcome|accept/i })).toBeVisible()
    await newPage.getByLabel(/full name/i).fill(`First Admin ${suffix}`)
    await newPage.getByLabel(/^password/i).fill('bootstrap-test-pw-123')
    await newPage.getByRole('button', { name: /accept|continue|create account/i }).click()

    // 7. Landing: admin shell, scoped to the new facility
    await newPage.waitForURL(/\/admin/, { timeout: 15_000 })
    await expect(newPage.getByText(/Admin Control Center/i)).toBeVisible()

    // 8. Prove tenant scope — the new admin can't see the seeded "Rink Alpha" facility
    await newPage.goto('/admin/users')
    // Seeded alpha user emails shouldn't appear; only the newly-created admin
    await expect(newPage.getByText('admin-alpha@rinkreports.test')).not.toBeVisible()
    await expect(newPage.getByText(firstAdminEmail)).toBeVisible()

    await freshContext!.close()
  })
})
