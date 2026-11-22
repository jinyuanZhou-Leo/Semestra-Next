// What `shot.mjs` and `requests.mjs` share: a signed-in browser on a running Semestra (by default
// the `pnpm dev:demo` account), with the first-run tour and "What's new" out of the way, and
// `{program}` / `{course}` / `{course:CODE}` / `{term}` in paths filled in from the account.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'

const web = path.resolve(import.meta.dirname, '../..')
const { version } = JSON.parse(readFileSync(path.join(web, 'package.json'), 'utf8'))

export function options(extra = {}) {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    allowPositionals: true,
    options: {
      web: { type: 'string', default: 'http://localhost:5173' },
      api: { type: 'string', default: 'http://localhost:8000' },
      email: { type: 'string', default: 'demo@example.com' },
      password: { type: 'string', default: 'semestra-demo-1' },
      width: { type: 'string', default: '1440' },
      height: { type: 'string', default: '900' },
      ...extra,
    },
  })
  return { ...values, paths: positionals.length ? positionals : ['/'] }
}

/** Launches Chromium and signs in through the API; the context shares the session cookies. */
export async function signedIn(opts, { scale = 1 } = {}) {
  const browser = await chromium.launch(
    process.env.CHROME ? { executablePath: process.env.CHROME } : {},
  )
  const context = await browser.newContext({
    viewport: { width: Number(opts.width), height: Number(opts.height) },
    deviceScaleFactor: scale,
  })
  const api = async (method, url, data) => {
    const cookies = await context.cookies(opts.api)
    const csrf = cookies.find((c) => c.name === 'semestra_csrf')?.value
    const response = await context.request.fetch(`${opts.api}${url}`, {
      method,
      data,
      headers: csrf ? { 'x-semestra-csrf': csrf } : {},
    })
    if (!response.ok()) {
      throw new Error(`${method} ${url}: ${response.status()} ${await response.text()}`)
    }
    return response.status() === 204 ? null : response.json()
  }
  await api('POST', '/auth/password/login', { email: opts.email, password: opts.password })
  await api('PUT', '/me/ui-state/onboarding.tour_done', { value: true })
  await api('PUT', '/me/ui-state/release.last_seen', { value: version })
  return { browser, context, api }
}

/** `{program}`, `{term}`, `{course}` and `{course:ECE201H1}` → ids from the account. */
export async function resolvePaths(api, paths) {
  if (!paths.some((p) => p.includes('{'))) return paths
  const programs = await api('GET', '/programs')
  const program = (programs.items ?? programs)[0]
  const courses = await api('GET', `/programs/${program.id}/courses`)
  const list = courses.items ?? courses
  const terms = await api('GET', `/programs/${program.id}/terms`)
  const today = new Date().toISOString().slice(0, 10)
  const termList = terms.items ?? terms
  const term = termList.find((t) => t.start_date <= today && today <= t.end_date) ?? termList[0]
  return paths.map((p) =>
    p
      .replaceAll('{program}', program.id)
      .replaceAll('{term}', term?.id ?? '')
      .replace(/\{course(?::([^}]+))?\}/g, (_, code) => {
        const found = code ? list.find((c) => c.code === code) : list.find((c) => c.code)
        if (!found) throw new Error(`no course ${code ?? ''} in the account`)
        return found.id
      }),
  )
}

/** Waits until the page has stopped loading: no skeletons or spinners, then a short pause. */
export async function settled(page) {
  await page.waitForLoadState('load')
  await page
    .waitForFunction(
      () =>
        !document.querySelector('#boot') &&
        !document.querySelector('[data-slot="skeleton"], [data-slot="spinner"]'),
      null,
      { timeout: 15_000 },
    )
    .catch(() => console.warn(`  still loading after 15 s: ${page.url()}`))
  await page.waitForTimeout(400)
}
