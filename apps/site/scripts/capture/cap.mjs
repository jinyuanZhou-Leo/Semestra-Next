import { OUT, WEB, launch, NOW } from './env.mjs'
import { readFileSync } from 'node:fs'
const ids = JSON.parse(readFileSync(OUT + '/ids.json', 'utf8'))
const [scheme = 'light', locale = 'en-US', only] = process.argv.slice(2)
const web = WEB
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
const P = `/p/${ids.prog}`
const shots = {
  today: P + '/today',
  calendar: `${P}/t/${ids.fall}/calendar`,
  tasks: P + '/tasks',
  grades: `${P}/c/${ids.courses.ECE244H1}/grades`,
  termgrades: `${P}/t/${ids.fall}/grades`,
  overview: P,
}
for (const [name, url] of Object.entries(shots)) {
  if (only && !only.split(',').includes(name)) continue
  await p.goto(web + url)
  await p.waitForLoadState('networkidle')
  await p.waitForTimeout(1500)
  const exit = p.locator('button', { hasText: /Exit plan mode|退出规划/ }).first()
  if (await exit.isVisible().catch(() => false)) {
    await exit.click()
    await p.waitForTimeout(1000)
  }
  await p.screenshot({ path: `${OUT}/out/${name}-${scheme}-${locale}.png` })
  if (name === 'grades') {
    await p
      .locator('button', { hasText: /^(Plan|规划)$/ })
      .first()
      .click()
    await p.waitForTimeout(1500)
    await p.screenshot({ path: `${OUT}/out/plan-${scheme}-${locale}.png` })
    await p
      .locator('button', { hasText: /Fill in to reach target|补全到目标|填/ })
      .first()
      .click()
      .catch(() => console.log('no fill'))
    await p.waitForTimeout(1500)
    await p.screenshot({ path: `${OUT}/out/planfill-${scheme}-${locale}.png` })
    await p
      .locator('button', { hasText: /Exit plan mode|退出规划/ })
      .first()
      .click()
      .catch(() => {})
  }
  console.log(name)
}
await b.close()
