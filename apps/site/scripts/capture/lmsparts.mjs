// The LMS pieces, once lms.mjs has connected the stand-in Canvas: ECE244's Canvas tab and the sync
// panel with what was posted since. Runs after every other shot, since the sync status line shows
// up in the sidebar of every page once Canvas is connected.
import { readFileSync } from 'node:fs'
import { OUT, WEB, NOW, around, launch, part } from './env.mjs'

const ids = JSON.parse(readFileSync(OUT + '/ids.json', 'utf8'))
const [scheme = 'light', locale = 'en-US'] = process.argv.slice(2)
const tag = `${scheme}-${locale}`
const b = await launch()
const ctx = await b.newContext({
  viewport: { width: 1440, height: 1200 },
  deviceScaleFactor: 2,
  colorScheme: scheme,
  locale,
  storageState: OUT + '/state.json',
  timezoneId: 'America/Toronto',
})
const p = await ctx.newPage()
await p.clock.setFixedTime(NOW)
await p.goto(`${WEB}/p/${ids.prog}/c/${ids.courses.ECE244H1}/canvas`)
await p.waitForLoadState('networkidle')
await p
  .getByText(/^(Assignments & grades|作业与成绩)$/)
  .filter({ visible: true })
  .first()
  .click()
await p.waitForTimeout(2500)
// The assignments table, from its toolbar to the bottom of the Quizzes rows.
const toolbar = p.getByRole('button', { name: /^(All|全部)$/ }).first()
const box = await around(toolbar, p.locator('main tr').nth(12))
// The margin stops at the last row's bottom border, so the next group doesn't peek in.
await part(
  p,
  `lms-${tag}`,
  { x: box.x - 28, y: box.y - 24, width: box.width + 52, height: box.height + 25 },
  { pad: 0 },
)

// The sync panel, opened from its status line in the sidebar: what changed on Canvas, waiting for a
// decision. `lmssync` is its header and first item, for the hero.
await p
  .getByText(/^Canvas · /)
  .first()
  .click()
await p.waitForTimeout(1500)
const panel = p.locator('[data-slot=popover-content]').first()
await part(p, `lmssync-${tag}`, panel, { cut: true })
const first = panel.getByRole('button', { name: /^(Import|导入)$/ }).first()
const head = await panel.boundingBox()
const item = await first.boundingBox()
await part(p, `lmsnew-${tag}`, { ...head, height: item.y + item.height + 14 - head.y }, { pad: 0 })
console.log('lms parts', tag)
await b.close()
