// Pieces of the real UI for the site's feature cards: one call per scheme and locale.
import { readFileSync } from 'node:fs'
import { OUT, WEB, NOW, around, exitPlan, launch, part } from './env.mjs'

const ids = JSON.parse(readFileSync(OUT + '/ids.json', 'utf8'))
const [scheme = 'light', locale = 'en-US'] = process.argv.slice(2)
const tag = `${scheme}-${locale}`
const b = await launch()
const ctx = await b.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: scheme,
  locale,
  storageState: OUT + '/state.json',
  // The fake clock breaks @date-fns/tz unless the browser is already in the Program's zone.
  timezoneId: 'America/Toronto',
})
const P = `${WEB}/p/${ids.prog}`
const open = async (url, height = 1000, width = 1440) => {
  const p = await ctx.newPage()
  await p.setViewportSize({ width, height })
  await p.clock.setFixedTime(NOW)
  await p.goto(url)
  await p.waitForLoadState('networkidle')
  await p.waitForTimeout(1200)
  return p
}

// Narrower than the other shots, so today's classes card is not mostly empty space.
let p = await open(P + '/today', 1000, 1040)
await part(p, `classes-${tag}`, p.locator('[data-card="schedule.today"]'), { cut: true })
await p.close()
p = await open(P + '/today')
await part(p, `upcoming-${tag}`, p.locator('[data-card="schedule.upcoming"]'), { cut: true })
await p.keyboard.press('Control+k')
await p.waitForTimeout(800)
await part(p, `palette-${tag}`, p.locator('[role=dialog]').first(), { cut: true })
await p.close()

// Tall enough that the week grid needs no inner scrolling.
p = await open(`${P}/t/${ids.fall}/calendar`, 1700)
await part(p, `week-${tag}`, p.locator('.semestra-calendar').first())
await part(
  p,
  `filters-${tag}`,
  await around(p.locator('fieldset').first(), p.locator('fieldset').nth(1)),
)
await p.close()

// A new task being added in place, under the last few tasks of the list.
p = await open(P + '/tasks', 1400)
await p
  .getByRole('button', { name: /^(New task|新待办)$/ })
  .first()
  .click()
await p.waitForTimeout(600)
await p.keyboard.type(
  locale === 'zh-CN' ? 'ECE216 期中复习：Laplace 变换' : 'ECE216 midterm review: Laplace',
)
await p.waitForTimeout(800)
// The row being written, with its date, priority, course and flag chips.
const editor = p.locator(':focus').locator('xpath=ancestor::li[1]')
const rows = p.locator('main li')
const count = await rows.count()
const list = await around(rows.nth(Math.max(0, count - 4)), editor)
// Less margin on top, where the row above would peek in.
await part(p, `tasklist-${tag}`, { ...list, y: list.y + 14, height: list.height - 14 }, { pad: 20 })
await p.close()

p = await open(`${P}/c/${ids.courses.ECE244H1}/grades`)
await exitPlan(p)
const gpa = p.locator('aside section').first()
await part(p, `gpa-${tag}`, gpa, { cut: true })
await part(p, `forecast-${tag}`, p.locator('aside section').nth(1), { cut: true })
await part(
  p,
  `gradebook-${tag}`,
  p.locator('main table').first().locator('xpath=ancestor::*[contains(@class, "rounded")][1]'),
  { cut: true },
)
await p
  .locator('button', { hasText: /^(Plan|规划)$/ })
  .first()
  .click()
await p.waitForTimeout(1000)
await p
  .locator('button', { hasText: /Fill in to reach target|补全到目标|填/ })
  .first()
  .click()
  .catch(() => {})
await p.waitForTimeout(1500)
await part(p, `gpaplan-${tag}`, p.locator('aside').first())
await exitPlan(p)
await p.close()

p = await open(`${P}/c/${ids.courses.ECE244H1}/schedule`, 1500)
await part(
  p,
  `meetings-${tag}`,
  p.locator('main div:has(> table), main [data-slot=table-container]').first(),
  { cut: true },
)
await p.close()

// Notification reminders: the settings group, as the settings dialog shows it.
p = await open(`${P}/today?settings=account/notifications`)
await part(
  p,
  `reminders-${tag}`,
  p.locator('#notifications-reminders').locator('xpath=(.//*[contains(@class, "rounded")])[1]'),
  { cut: true },
)
await p.close()

// The file preview with its outline, searching inside the lecture slides.
p = await open(`${P}/c/${ids.courses.ECE216H1}/files`, 1000)
await p.getByText('Lecture 9').first().click()
await p.waitForTimeout(2500)
await p
  .getByRole('dialog')
  .getByRole('searchbox')
  .or(p.getByRole('dialog').locator('input'))
  .first()
  .fill('transfer function')
await p.waitForTimeout(2500)
await part(p, `preview-${tag}`, p.getByRole('dialog').first(), { cut: true })
await p.close()

console.log('parts', tag)
await b.close()
