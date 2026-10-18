import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// See auth.spec.ts: the dev API appends every email to <data dir>/dev-outbox.jsonl.
const OUTBOX = path.resolve(import.meta.dirname, '../../api/data/dev-outbox.jsonl')

function latestCode(email: string): string {
  let lines: string[]
  try {
    lines = readFileSync(OUTBOX, 'utf8').trim().split('\n')
  } catch {
    return '' // not written yet
  }
  for (const line of lines.reverse()) {
    const mail = JSON.parse(line) as { to: string; text: string }
    if (mail.to === email) return /\b(\d{6})\b/.exec(mail.text)![1]!
  }
  return ''
}

async function signUp(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect.poll(() => latestCode(email)).toMatch(/^\d{6}$/)
  await page.keyboard.type(latestCode(email))
  await page.getByLabel('Name').fill('Ada')
  await page.getByRole('button', { name: 'Create account' }).click()
}

test('a new user goes through onboarding and sees the term with its courses (M02 §9)', async ({
  page,
}) => {
  await signUp(page, `e2e-academics-${Date.now()}@example.com`)
  await expect(page).toHaveURL(/\/onboarding/)
  await page.getByRole('button', { name: 'Next' }).click()

  await page.getByLabel('Name').fill('Computer Engineering')
  await page.getByLabel('School').fill('University of Toronto')
  await page.getByRole('button', { name: 'Next' }).click()

  await page.getByLabel('First day').fill('2026-09-08')
  await page.getByLabel('Last day').fill('2026-12-20')
  await expect(page.getByLabel('Name')).toHaveValue('Fall 2026')
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Add course' }).click()
  await page.getByLabel('Code, row 1').fill('APS105H1')
  await page.getByLabel('Title, row 1').fill('Computer Fundamentals')
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Create term' }).click()

  await page.getByRole('button', { name: 'Go to my term' }).click()
  await expect(page).toHaveURL(/\/p\/[^/]+\/t\/[^/]+$/)
  const sidebar = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(sidebar.getByRole('link', { name: /APS105H1/ })).toBeVisible()
  // The tour points at what exists (the command palette and assistant come later).
  await page.getByRole('button', { name: /^(Skip tour|Done)$/ }).click()
  await expect(
    page.getByRole('link', { name: /Computer Fundamentals|APS105H1/ }).first(),
  ).toBeVisible()
  // Only one Program: the switcher is nowhere.
  await expect(page.getByRole('button', { name: 'Switch Program' })).toHaveCount(0)
})
