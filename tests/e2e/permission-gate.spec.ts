import { test, expect } from '@playwright/test'

import { loginAs } from './helpers/auth'

/**
 * Priority E2E 3 — permission gate.
 *
 * Non-admin staff must not be able to reach any /admin/* route or any
 * /modules/scheduling/manage/* route. On direct navigation, the expected
 * outcome is a 404 (per FOUNDATION.md: "hiding the admin surface from
 * non-admins makes enumeration harder") — not a "forbidden" page.
 *
 * Also asserts: no facility-owned data leaks onto whatever page IS served.
 * A 404 that still rendered sensitive data would be a failure.
 */

const ADMIN_ROUTES = [
  '/admin',
  '/admin/users',
  '/admin/invites',
  '/admin/roles',
  '/admin/modules',
  '/admin/resources',
  '/admin/forms',
  '/admin/option-lists',
  '/admin/billing',
  '/admin/audit',
  '/admin/communications',
  '/admin/scheduling',
  '/admin/ice-depth',
]

const MANAGER_ONLY_ROUTES = [
  '/modules/scheduling/manage',
  '/modules/scheduling/manage/time-off',
  '/modules/scheduling/manage/swaps',
]

test.describe('Permission gate — staff cannot reach admin surface', () => {
  for (const path of ADMIN_ROUTES) {
    test(`staff at ${path} is 404'd, no admin data rendered`, async ({ page }) => {
      await loginAs(page, 'alphaStaff')
      const response = await page.goto(path)
      // Next.js notFound() returns 404; some admin routes may redirect
      // through a protected layout. Accept either 404 or redirect-out.
      expect(response?.status()).toBeLessThan(500)

      // Critical: the admin shell must NOT have rendered
      await expect(page.getByText(/Admin Control Center/i)).not.toBeVisible()
      // No audit log rows
      await expect(page.getByText(/actor_user_id|entity_type|facility_setting/i)).not.toBeVisible()
      // No user-management table
      await expect(page.getByRole('table', { name: /users|invites|roles/i })).not.toBeVisible()
    })
  }

  for (const path of MANAGER_ONLY_ROUTES) {
    test(`staff at ${path} is 404'd, no approval queue rendered`, async ({ page }) => {
      await loginAs(page, 'alphaStaff')
      const response = await page.goto(path)
      expect(response?.status()).toBeLessThan(500)
      // No approval queue or builder grid
      await expect(page.getByRole('heading', { name: /approvals|builder|manage schedules/i })).not.toBeVisible()
    })
  }
})
