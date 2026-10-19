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
    return ''
  }
  for (const line of lines.reverse()) {
    const mail = JSON.parse(line) as { to: string; text: string }
    if (mail.to === email) return /\b(\d{6})\b/.exec(mail.text)![1]!
  }
  return ''
}

/** Signs up and creates a Program with one term (the current one) and one course. */
async function setUp(page: Page) {
  const email = `e2e-schedule-${Date.now()}@example.com`
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect.poll(() => latestCode(email)).toMatch(/^\d{6}$/)
  await page.keyboard.type(latestCode(email))
  await page.getByLabel('Name').fill('Ada')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/onboarding/)
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByLabel('Name').fill('Computer Engineering')
  await page.getByRole('button', { name: 'Next' }).click()
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  await page.getByLabel('First day').fill(iso(new Date(today.getTime() - 30 * 86_400_000)))
  await page.getByLabel('Last day').fill(iso(new Date(today.getTime() + 60 * 86_400_000)))
  await page.getByLabel('Name').fill('This term')
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Add course' }).click()
  await page.getByLabel('Code, row 1').fill('APS105H1')
  await page.getByLabel('Title, row 1').fill('Computer Fundamentals')
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Create term' }).click()
  await page.getByRole('button', { name: 'Go to my term' }).click()
  await expect(page).toHaveURL(/\/p\/[^/]+\/t\/[^/]+$/)
  await page.getByRole('button', { name: /^(Skip tour|Done)$/ }).click()
  return new URL(page.url()).pathname
}

test('a meeting added on the course page shows in the term calendar and today (M04 §9)', async ({
  page,
}) => {
  const termPath = await setUp(page)
  const programPath = termPath.replace(/\/t\/.*$/, '')
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: /APS105H1/ })
    .click()
  await expect(page).toHaveURL(/\/c\/[^/?]+/)
  const coursePath = new URL(page.url()).pathname
  await page.goto(`${coursePath}/schedule`)

  await page.getByRole('button', { name: 'Add meeting' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Section').fill('LEC0101')
  await dialog.getByLabel('Location').fill('BA 1160')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('cell', { name: 'LEC0101', exact: true })).toBeVisible()

  await page.goto(`${termPath}/calendar`)
  await expect(page.locator('.fc-event', { hasText: 'APS105H1' }).first()).toBeVisible()
  await page.getByRole('radio', { name: 'Timetable' }).click()
  await expect(page.getByTestId('grid-item').filter({ hasText: 'APS105H1 LEC' })).toBeVisible()

  await page.goto(`${programPath}/today`)
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible()
  await expect(page.getByText("Today's classes")).toBeVisible()
})
