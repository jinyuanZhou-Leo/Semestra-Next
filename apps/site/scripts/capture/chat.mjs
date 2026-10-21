import { OUT, WEB, launch, NOW } from './env.mjs'
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
})
const p = await ctx.newPage()
await p.clock.setFixedTime(NOW)
await p.goto(`${WEB}/p/${ids.prog}/assistant`)
await p.waitForLoadState('networkidle')
await p.waitForTimeout(1000)
const box = p.locator('textarea').first()
await box.fill(msg)
await box.press('Enter')
await p
  .locator('button', { hasText: /^(Approve|批准|允许|同意)$/ })
  .first()
  .waitFor({ timeout: 40000 })
  .catch(() => console.log('no approve'))
await p.waitForTimeout(800)
await p.screenshot({ path: `${OUT}/out/${out}card-${scheme}-${locale}.png` })
if (process.env.APPROVE) {
  await p
    .locator('button', { hasText: /^(Approve|批准|允许|同意)$/ })
    .first()
    .click()
  await p.waitForTimeout(4000)
}
await p.screenshot({ path: `${OUT}/out/${out}-${scheme}-${locale}.png` })
console.log(p.url())
await b.close()
