// What `shot.mjs` and `requests.mjs` share: a signed-in browser on a running Semestra (by default
// the `pnpm dev:demo` account) and `{program}` / `{course}` / `{course:CODE}` / `{term}` in paths
// filled in from the account. Pages open in a fresh context whose preference and UI-state reads
// are answered in the browser (tour and "What's new" seen, everything else at its default) and
// whose UI-state writes never reach the server, so every page starts from the same state and the
// account is left as it was.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

/** Launches Chromium and signs in through the API; `page()` opens a page in a fresh context. */
export async function signedIn(opts, { scale = 1 } = {}) {
  const browser = await chromium.launch(
    process.env.CHROME ? { executablePath: process.env.CHROME } : {},
  )
  const session = await browser.newContext()
  const api = async (method, url, data) => {
    const cookies = await session.cookies(opts.api)
    const csrf = cookies.find((c) => c.name === 'semestra_csrf')?.value
    const response = await session.request.fetch(`${opts.api}${url}`, {
      method,
      data,
      headers: csrf ? { 'x-semestra-csrf': csrf } : {},
    })
    if (!response.ok()) {
      throw new Error(`${method} ${url}: ${response.status()} ${await response.text()}`)
    }
    return response.status() === 204 ? null : response.json()
  }
  // Sign-ins are rate limited, so the session is kept between runs.
  const saved = path.join(
    web,
    'node_modules/.cache/semestra-dev',
    `${encodeURIComponent(`${opts.api}|${opts.email}`)}.json`,
  )
  try {
    await session.addCookies(JSON.parse(readFileSync(saved, 'utf8')))
    await api('GET', '/account/me')
  } catch {
    await session.clearCookies()
    await api('POST', '/auth/password/login', { email: opts.email, password: opts.password })
  }
  const { cookies } = await session.storageState()
  mkdirSync(path.dirname(saved), { recursive: true })
  writeFileSync(saved, JSON.stringify(cookies))

  /** `preferences` overrides what `GET /me/preferences` answers (theme, locale…). */
  const page = async ({ preferences = {}, reducedMotion = 'no-preference' } = {}) => {
    const context = await browser.newContext({
      viewport: { width: Number(opts.width), height: Number(opts.height) },
      deviceScaleFactor: scale,
      reducedMotion,
      storageState: { cookies, origins: [] },
    })
    await pinState(context, opts.api, preferences)
    const opened = await context.newPage()
    track(opened)
    return opened
  }
  return { browser, api, page }
}

/** Data requests in flight per page (the SSE stream stays open, so it doesn't count). */
const inflight = new WeakMap()
const isData = (request) =>
  ['fetch', 'xhr'].includes(request.resourceType()) &&
  !new URL(request.url()).pathname.endsWith('/events/stream')

function track(page) {
  const open = new Set()
  inflight.set(page, open)
  page.on('request', (r) => isData(r) && open.add(r))
  for (const done of ['requestfinished', 'requestfailed']) page.on(done, (r) => open.delete(r))
}

const SEEN = { 'onboarding.tour_done': true, 'release.last_seen': version }

async function pinState(context, apiUrl, preferences) {
  const api = new URL(apiUrl).origin
  // A request still open when the page closes ends its handler with an error; nothing to do then.
  const route = (match, handle) =>
    context.route(match, (r) => Promise.resolve(handle(r)).catch(() => {}))
  const at = (pathname) => (url) => url.origin === api && url.pathname === pathname
  // Changes made on the page show on the page (later reads included) but aren't saved.
  let changes = {}
  let current = {}
  await route(at('/me/preferences'), async (r) => {
    const request = r.request()
    if (request.method() === 'GET') {
      const response = await r.fetch()
      current = { ...(await response.json()), ...changes, ...preferences }
      return r.fulfill({ response, json: current })
    }
    changes = { ...changes, ...request.postDataJSON() }
    current = { ...current, ...changes, ...preferences }
    return r.fulfill({ json: current })
  })
  await route(at('/me/ui-state:get'), (r) => {
    const { keys = [], prefixes = [] } = r.request().postDataJSON() ?? {}
    const items = Object.fromEntries(
      Object.entries(SEEN).filter(
        ([key]) => keys.includes(key) || prefixes.some((p) => key.startsWith(p)),
      ),
    )
    return r.fulfill({ json: { items } })
  })
  await route(
    (url) => url.origin === api && url.pathname.startsWith('/me/ui-state/'),
    (r) => {
      const key = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop())
      return r.fulfill({ json: { key, value: r.request().postDataJSON()?.value ?? null } })
    },
  )
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

/** Waits until the page has stopped loading: no boot screen, skeletons or spinners, and no data
 * requests in flight. */
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
  // Then until no data request has been in flight for 300 ms (one may start another).
  const open = inflight.get(page) ?? new Set()
  const deadline = Date.now() + 15_000
  let quietSince = Date.now()
  while (Date.now() < deadline) {
    if (open.size) quietSince = Date.now()
    else if (Date.now() - quietSince >= 300) break
    await page.waitForTimeout(50)
  }
}
