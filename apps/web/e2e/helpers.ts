import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'

/** The newest sign-in code sent to `email` (playwright.config.ts sets E2E_OUTBOX). */
function latestCode(email: string): string {
  let lines: string[]
  try {
    lines = readFileSync(process.env.E2E_OUTBOX!, 'utf8').trim().split('\n')
  } catch {
    return '' // not written yet
  }
  for (const line of lines.reverse()) {
    const mail = JSON.parse(line) as { to: string; text: string }
    if (mail.to === email) return /\b(\d{6})\b/.exec(mail.text)![1]!
  }
  return ''
}

export function uniqueEmail(name: string): string {
  return `e2e-${name}-${Date.now()}@example.com`
}

/** Signs up with an email code; a new account lands on onboarding. */
export async function signUp(page: Page, email: string, name: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText(/A 6-digit code was sent/)).toBeVisible()
  await expect.poll(() => latestCode(email)).toMatch(/^\d{6}$/)
  await page.keyboard.type(latestCode(email))
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByTestId('signed-in-as')).toContainText(name)
  await expect(page).toHaveURL(/\/onboarding/)
}

/**
 * Goes through onboarding: a Program, a term running today and one course. Returns the term's
 * path; the tour is dismissed.
 */
export async function onboard(
  page: Page,
  course = { code: 'APS105H1', title: 'Computer Fundamentals' },
) {
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByLabel('Name').fill('Computer Engineering')
  await page.getByLabel('School').fill('University of Toronto')
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // The 1st of this month to the 15th of the next: the calendar opens on this month and shows
  // the next, and neither number can be one of the other month's days shown around the grid.
  await page.getByRole('button', { name: 'Dates' }).click()
  const months = page.getByRole('grid')
  await months
    .nth(0)
    .getByRole('button', { name: /\b1st\b/ })
    .first()
    .click()
  await months
    .nth(1)
    .getByRole('button', { name: /\b15th\b/ })
    .click()
  await page.keyboard.press('Escape')
  await page.getByLabel('Name').fill('This term')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: 'Add course' }).click()
  await page.getByLabel('Code, row 1').fill(course.code)
  await page.getByLabel('Title, row 1').fill(course.title)
  await page.getByRole('button', { name: 'Create term' }).click()
  await expect(page.getByRole('heading', { name: 'Connect AI (optional)' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip' }).click()

  await page.getByRole('button', { name: 'Go to my term' }).click()
  await expect(page).toHaveURL(/\/p\/[^/]+\/t\/[^/]+$/)
  await page.getByRole('button', { name: /^(Skip tour|Done)$/ }).click()
  return new URL(page.url()).pathname
}
