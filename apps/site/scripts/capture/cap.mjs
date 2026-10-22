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
  // The fake clock breaks @date-fns/tz unless the browser is already in the Program's zone.
  timezoneId: 'America/Toronto',
})
const p = await ctx.newPage()
await p.clock.setFixedTime(NOW)
const P = `/p/${ids.prog}`
// The full-window shots; the smaller pieces of UI come from parts.mjs.
const shots = { today: P + '/today' }
for (const [name, url] of Object.entries(shots)) {
  if (only && !only.split(',').includes(name)) continue
  await p.goto(web + url)
  await p.waitForLoadState('networkidle')
  await p.waitForTimeout(1500)
  await p.screenshot({ path: `${OUT}/out/${name}-${scheme}-${locale}.png` })
  console.log(name)
}
await b.close()
