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
await part(p, `week-${tag}`, p.locator('.fc').first())
await part(
  p,
  `filters-${tag}`,
  await around(p.locator('fieldset').first(), p.locator('fieldset').nth(1)),
)
await p.close()

p = await open(P + '/tasks')
const add = await p.locator('input[data-slot=input]').first().boundingBox()
await part(p, `tasklist-${tag}`, { x: add.x - 8, y: add.y - 6, width: add.width + 16, height: 380 })
await p.close()

p = await open(`${P}/c/${ids.courses.ECE244H1}/grades`)
await exitPlan(p)
const gpa = p.locator('aside section').first()
await part(p, `gpa-${tag}`, gpa, { cut: true })
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

console.log('parts', tag)
await b.close()
