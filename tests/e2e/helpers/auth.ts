import type { Page } from '@playwright/test'

/**
 * Sign a user in via the /login page. Tests that need a specific role start
 * with `loginAs(page, 'alphaAdmin')` at the top of the test body.
 *
 * This path uses the real auth UI so any change to the login page (e.g.
 * adding MFA) surfaces in e2e as a login-helper failure — exactly what we
 * want.
 */

import { SEEDED_USERS } from '../../factories/supabase-client'

export type SeededUserKey = keyof typeof SEEDED_USERS

export async function loginAs(page: Page, userKey: SeededUserKey) {
  const user = SEEDED_USERS[userKey]
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(user.email)
  await page.getByLabel(/password/i).fill(user.password)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  // Landing page varies by role; just wait for the /login URL to leave.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 10_000 })
}

export async function logout(page: Page) {
  // Clear auth storage — cheapest way to drop the session without depending
  // on a particular sign-out UI.
  await page.context().clearCookies()
  await page.goto('/login')
}
