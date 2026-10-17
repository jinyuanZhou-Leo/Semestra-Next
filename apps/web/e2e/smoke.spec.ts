import { expect, test } from '@playwright/test'

test('the login page loads and the API is reachable', async ({ page, request }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await expect(page.getByRole('heading', { name: 'Welcome to Semestra' })).toBeVisible()
  expect((await request.get('http://localhost:8000/healthz')).ok()).toBe(true)
})
