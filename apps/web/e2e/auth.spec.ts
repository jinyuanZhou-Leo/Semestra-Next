import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// The dev API (EMAIL_BACKEND=console) also appends every email to <data dir>/dev-outbox.jsonl.
const OUTBOX = path.resolve(import.meta.dirname, '../../api/data/dev-outbox.jsonl')

function latestCode(email: string): string {
  const lines = readFileSync(OUTBOX, 'utf8').trim().split('\n')
  for (const line of lines.reverse()) {
    const mail = JSON.parse(line) as { to: string; text: string }
    if (mail.to === email) return /\b(\d{6})\b/.exec(mail.text)![1]!
  }
  throw new Error(`no email for ${email}`)
}

async function signUp(page: Page, email: string, name: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText(/We sent a 6-digit code/)).toBeVisible()
  await expect.poll(() => latestCode(email)).toMatch(/^\d{6}$/)
  await page.keyboard.type(latestCode(email))
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByTestId('signed-in-as')).toContainText(name)
}

test('sign up with an email code, manage tokens, sign out, sign back in with a password', async ({
  page,
}) => {
  const email = `e2e-${Date.now()}@example.com`
  await signUp(page, email, 'Eve')

  // the session survives a reload (HttpOnly cookie + /account/me)
  await page.reload()
  await expect(page.getByTestId('signed-in-as')).toContainText('Eve')

  // A new account has no Program yet: it lands on onboarding; settings are one URL away.
  await expect(page).toHaveURL(/\/onboarding/)
  await page.goto('/settings/account')
  await page.getByRole('button', { name: 'Set password' }).click()
  await page.getByLabel('New password').fill('a long enough passphrase')
  await page.getByRole('button', { name: 'Save', exact: true }).last().click()
  await expect(page.getByText('Set', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Create token' }).first().click()
  await page.getByLabel('Name').last().fill('Playwright')
  await page.getByRole('dialog').getByRole('button', { name: 'Create token' }).click()
  await expect(page.getByTestId('new-token')).toContainText('spat_')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('Playwright')).toBeVisible()

  await page.getByRole('button', { name: 'Sign out', exact: true }).first().click()
  await expect(page).toHaveURL(/\/login/)

  await page.getByRole('button', { name: 'Sign in with a password' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('a long enough passphrase')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByTestId('signed-in-as')).toContainText('Eve')
})
