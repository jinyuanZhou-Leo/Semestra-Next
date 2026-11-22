// Lists the API requests (fetch/XHR, the SSE stream aside) a page makes when it is opened directly:
// how many per route, which repeat, which were cancelled, and how long they took. It counts a cold
// open, shell included, not navigation inside the app. Use it to check a change doesn't add
// requests or fetch the same thing twice.
// Needs a running Semestra (`pnpm dev:demo`, or `pnpm dev` with --email/--password).
//
//   pnpm --filter @semestra/web requests /p/{program}/today
//
// Paths may use {program}, {term}, {course} and {course:CODE}. --wait <ms> keeps listening after
// the page settles (default 1000), for requests that start late.
import { options, resolvePaths, settled, signedIn } from './browser.mjs'

const opts = options({ wait: { type: 'string', default: '1000' } })
const { browser, api, page: open } = await signedIn(opts)
const route = (url) => url.pathname.replace(/\/[0-9a-f-]{20,}(?=\/|$)/g, '/{id}')
try {
  const paths = await resolvePaths(api, opts.paths)
  for (const url of paths) {
    const page = await open()
    const seen = []
    const record = async (request, failure) => {
      if (!['fetch', 'xhr'].includes(request.resourceType())) return
      const at = new URL(request.url())
      if (at.pathname.endsWith('/events/stream')) return
      const response = failure ? null : await request.response()
      seen.push({
        key: `${request.method()} ${at.pathname}${at.search}`,
        route: `${request.method()} ${route(at)}`,
        status: response?.status() ?? 0,
        failure,
        ms: Math.max(0, Math.round(request.timing().responseEnd)),
      })
    }
    page.on('requestfinished', (request) => record(request, null))
    page.on('requestfailed', (request) => record(request, request.failure()?.errorText ?? 'failed'))
    const started = Date.now()
    await page.goto(new URL(url, opts.web).href)
    await settled(page)
    await page.waitForTimeout(Number(opts.wait))
    const byRoute = Map.groupBy(seen, (r) => r.route)
    const repeated = [...Map.groupBy(seen, (r) => r.key)].filter(([, rs]) => rs.length > 1)
    console.log(`\n${url}: ${seen.length} API requests in ${Date.now() - started} ms`)
    const rows = [...byRoute].sort((a, b) => b[1].length - a[1].length)
    for (const [name, rs] of rows) {
      const slowest = Math.max(...rs.map((r) => r.ms))
      const failed = rs.filter((r) => r.status >= 400).length
      const cancelled = rs.filter((r) => r.failure).length
      const notes = [`slowest ${slowest} ms`]
      if (failed) notes.push(`${failed} failed`)
      if (cancelled) notes.push(`${cancelled} cancelled or cut off`)
      console.log(`  ${String(rs.length).padStart(3)}×  ${name}  (${notes.join(', ')})`)
    }
    if (repeated.length) {
      console.log('  Same request more than once:')
      for (const [key, rs] of repeated) console.log(`    ${rs.length}×  ${key}`)
    }
    await page.context().close()
  }
} finally {
  await browser.close()
}
