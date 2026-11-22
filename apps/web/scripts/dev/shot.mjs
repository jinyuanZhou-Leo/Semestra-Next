// Screenshots of pages in light and dark, in Chinese, at 2x: the samples UI changes are reviewed
// with. Needs a running Semestra (`pnpm dev:demo`, or `pnpm dev` with --email/--password).
//
//   pnpm --filter @semestra/web shot /p/{program}/today /p/{program}/c/{course:ECE201H1}/grades
//
// Paths may use {program}, {term}, {course} and {course:CODE}. Options: --out <dir> (default
// .shots/), --locale en|zh-CN, --themes light,dark, --width/--height (1440×900), --web/--api,
// --email/--password. Theme, language and reduced motion are set in the browser, not saved to the
// account; each page starts from the default interface state (see browser.mjs), with animations
// off and the clock frozen at the start so both themes show the same times.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { options, resolvePaths, settled, signedIn } from './browser.mjs'

const opts = options({
  out: { type: 'string', default: path.resolve(import.meta.dirname, '../../.shots') },
  locale: { type: 'string', default: 'zh-CN' },
  themes: { type: 'string', default: 'light,dark' },
})
mkdirSync(opts.out, { recursive: true })
const { browser, api, page: open } = await signedIn(opts, { scale: 2 })
const now = new Date()
const written = []
try {
  const paths = await resolvePaths(api, opts.paths)
  for (const theme of opts.themes.split(',')) {
    for (const [i, url] of paths.entries()) {
      const page = await open({
        preferences: { theme, locale: opts.locale, reduce_motion: 'on' },
        reducedMotion: 'reduce',
      })
      await page.clock.setFixedTime(now)
      await page.addInitScript(
        ([t, l]) => {
          localStorage.setItem('semestra.theme', t)
          localStorage.setItem('PARAGLIDE_LOCALE', l)
        },
        [theme, opts.locale],
      )
      await page.goto(new URL(url, opts.web).href)
      await settled(page)
      const name = opts.paths[i]
        .replace(/[{}]/g, '')
        .replace(/[^\w.-]+/g, '-')
        .replace(/^-|-$/g, '')
      const file = path.join(opts.out, `${name || 'home'}-${theme}.png`)
      await page.screenshot({ path: file, animations: 'disabled' })
      written.push(file)
      await page.context().close()
    }
  }
} finally {
  await browser.close()
}
for (const file of written) console.log(file)
