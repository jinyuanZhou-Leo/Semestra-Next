import { OUT, WEB, launch, NOW, part } from './env.mjs'
import { readFileSync } from 'node:fs'
const ids = JSON.parse(readFileSync(OUT + '/ids.json', 'utf8'))
const [scheme = 'light', locale = 'en-US', msg = 'What do I have due next week?', out = 'sem'] =
  process.argv.slice(2)
const b = await launch()
const ctx = await b.newContext({
  viewport: { width: 1440, height: +(process.env.VH || 900) },
  deviceScaleFactor: 2,
  colorScheme: scheme,
  locale,
  storageState: OUT + '/state.json',
  // The fake clock breaks @date-fns/tz unless the browser is already in the Program's zone.
  timezoneId: 'America/Toronto',
})
const p = await ctx.newPage()
await p.clock.setFixedTime(NOW)
// Toasts (such as the LMS's new assignments) are not part of these shots.
await p.addInitScript(() =>
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style')
    style.textContent = '[data-sonner-toaster] { display: none !important }'
    document.head.append(style)
  }),
)
await p.goto(`${WEB}/p/${ids.prog}/assistant`)
await p.waitForLoadState('networkidle')
await p.waitForTimeout(1000)
// The message box is a rich-text editor.
await p.locator('[contenteditable=true]').first().click()
await p.keyboard.type(msg)
await p.keyboard.press('Enter')
await p
  .locator('button', { hasText: /^(Approve|批准|允许|同意)$/ })
  .first()
  .waitFor({ timeout: 40000 })
  .catch(() => console.log('no approve'))
await p.waitForTimeout(800)
// The proposal card on its own: the nearest bordered box around the approve button.
const approve = p.locator('button', { hasText: /^(Approve|批准|允许|同意)$/ }).first()
const card = approve.locator('xpath=ancestor::*[contains(@class, "border")][1]')
const tag = `${scheme}-${locale}`
await part(p, `proposal-${tag}`, card, { cut: true })
if (process.env.APPROVE) {
  await p
    .locator('button', { hasText: /^(Approve|批准|允许|同意)$/ })
    .first()
    .click()
  await p.waitForTimeout(4000)
}
await p.screenshot({ path: `${OUT}/out/${out}-${scheme}-${locale}.png` })
if (process.env.APPROVE) {
  // The conversation, from the question to the end of the answer, without the chat list beside it.
  const question = await p.getByText(msg).first().boundingBox()
  const thought = await p
    .getByText(/^(Thought for|思考了)/)
    .first()
    .boundingBox()
  const copy = await p
    .locator('main button')
    .filter({ has: p.locator('svg.lucide-copy') })
    .last()
    .boundingBox()
  const left = thought.x - 24
  await part(p, `answer-${tag}`, {
    x: left,
    y: question.y - 12,
    width: question.x + question.width + 20 - left,
    height: copy.y + copy.height - question.y + 24,
  })
}
console.log(p.url())
await b.close()
