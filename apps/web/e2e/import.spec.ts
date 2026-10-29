import { expect, test } from '@playwright/test'
import { onboard, signUp, uniqueEmail } from './helpers'

/** A weekly lecture that started two weeks ago, as a school's timetable export has it. */
function timetable(): Buffer {
  const start = new Date(Date.now() - 14 * 86_400_000)
  const day = start.toISOString().slice(0, 10).replaceAll('-', '')
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Semestra E2E//EN',
    'BEGIN:VEVENT',
    'UID:e2e-aps105-lec@example.com',
    `DTSTAMP:${day}T000000Z`,
    `DTSTART:${day}T140000Z`,
    `DTEND:${day}T150000Z`,
    'RRULE:FREQ=WEEKLY;COUNT=12',
    'SUMMARY:APS105H1 LEC0101',
    'LOCATION:BA 1160',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
  return Buffer.from(ics)
}

test('weekly meetings import from a calendar file into the course (M08)', async ({ page }) => {
  await signUp(page, uniqueEmail('import'), 'Ada')
  await onboard(page)

  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: /APS105H1/ })
    .click()
  await expect(page).toHaveURL(/\/c\/[^/?]+/)
  await page.goto(`${new URL(page.url()).pathname}/schedule`)

  await page.getByRole('button', { name: 'From existing material' }).click()
  await page.getByRole('menuitem', { name: /Calendar file \(ICS\)/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'timetable.ics',
    mimeType: 'text/calendar',
    buffer: timetable(),
  })
  await dialog.getByRole('button', { name: 'Read' }).click()
  await dialog.getByRole('button', { name: /^Save \d+ items?$/ }).click()

  await expect(page.getByRole('cell', { name: 'BA 1160' })).toBeVisible()
})
