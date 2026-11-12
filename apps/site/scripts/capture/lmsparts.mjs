// The LMS pieces, once lms.mjs has connected the stand-in Canvas: ECE244's Canvas tab with its
// changes banner, and the toast offering the new assignments. Runs after every other shot, since
// that toast shows up on any page of the Program.
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
const toast = p.locator('[data-sonner-toast]', { hasText: /new assignments|个新作业/ }).first()
await toast.waitFor()
// Let it finish sliding in, or the box is taken mid-way.
await p.waitForTimeout(1500)
// Only this toast: others stack behind it.
await p.addStyleTag({
  content: '[data-sonner-toast]:not([data-front]) { display: none !important }',
})
// The toast is translucent: nothing of the page may show through it.
const blank = await p.addStyleTag({ content: 'main { opacity: 0 !important }' })
await toast.evaluate((el) => el.setAttribute('data-front', ''))
await p.waitForTimeout(300)
await part(p, `lmstoast-${tag}`, toast, { cut: true })
await toast.evaluate((el) => el.style.setProperty('visibility', 'hidden'))
await blank.evaluate((n) => n.remove())
await p.waitForTimeout(300)
const banner = p
  .getByText(/imported assignments have changes|项已导入的作业有变化/)
  .locator('xpath=ancestor::*[contains(@class, "rounded")][1]')
const box = await around(banner, p.locator('main tr').nth(9))
// Ends at the bottom of the Quizzes row, without the next row peeking in.
await part(p, `lms-${tag}`, { ...box, height: box.height - 24 }, { pad: 24 })
console.log('lms parts', tag)
await b.close()
