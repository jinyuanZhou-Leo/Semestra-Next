// Runs the Bombadil specification (spec.ts) against a throwaway instance: the API serves the
// built SPA on one origin, as the all-in-one image does, with a fresh data directory. An account
// with a Program, a term running today, courses, assessments and tasks is created over HTTP, and
// Bombadil starts from `/` with its session cookies.
//
//   pnpm --filter @semestra/web bombadil [-- <bombadil options>]
//
// Options go to `bombadil browser test`, e.g. `--time-limit 10m` (default 2m) or
// `--width 375 --height 812` (the phone layout). Each run writes its trace and screenshots to
// bombadil/.runs/<time>/; `pnpm exec bombadil browser inspect <dir>` shows them step by step.
// The exit code is Bombadil's: 0 nothing failed, 2 a property failed, 1 something else went wrong.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import account from './account.json' with { type: 'json' }

const here = import.meta.dirname
const web = path.resolve(here, '..')
const api = path.resolve(web, '../api')
const port = Number(process.env.BOMBADIL_PORT ?? 8010)
const origin = `http://localhost:${port}`
const runs = path.join(here, '.runs')
const dataDir = path.join(runs, 'data')
const outbox = path.join(dataDir, 'dev-outbox.jsonl')
const output = path.join(runs, new Date().toISOString().replaceAll(':', '-').slice(0, 19))

// `--time-limit` gets a default and `--exit-on-violation` is always on; every other option goes to
// Bombadil as given.
const { values, tokens } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { 'time-limit': { type: 'string', default: '2m' } },
  strict: false,
  tokens: true,
})
const passThrough = tokens.flatMap((token) => {
  if (token.kind === 'positional') return [token.value]
  if (token.kind !== 'option' || ['time-limit', 'exit-on-violation'].includes(token.name)) return []
  return token.value === undefined ? [token.rawName] : [token.rawName, token.value]
})

rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

// Not whatever apps/api/.env says: prod writes no outbox, and resend would send real email.
const env = {
  ...process.env,
  SEMESTRA_ENV: 'dev',
  SEMESTRA_EMAIL_BACKEND: 'console',
  SEMESTRA_DATA_DIR: dataDir,
  SEMESTRA_DATABASE_URL: `sqlite+aiosqlite:///${dataDir}/semestra.db`,
  SEMESTRA_STORAGE_LOCAL_ROOT: path.join(dataDir, 'storage'),
  SEMESTRA_SERVE_WEB: 'true',
  SEMESTRA_WEB_DIST_DIR: path.join(web, 'dist'),
  SEMESTRA_PUBLIC_WEB_ORIGIN: origin,
  SEMESTRA_PUBLIC_API_ORIGIN: origin,
  SEMESTRA_CORS_ORIGINS: JSON.stringify([origin]),
}

/** `uv run --no-sync`: a syncing `uv run` would drop extras (ocr, embedding) installed in .venv. */
function uv(args, options = {}) {
  return spawn('uv', ['run', '--no-sync', '--project', api, ...args], {
    cwd: api,
    env,
    stdio: 'inherit',
    ...options,
  })
}

function exited(child) {
  return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)))
}

async function waitUntilReady(server) {
  for (let i = 0; i < 240 && server.exitCode === null; i++) {
    try {
      if ((await fetch(`${origin}/readyz`)).ok) return
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`the API did not become ready on ${origin}`)
}

/** A tiny HTTP client that keeps the session cookies and sends the CSRF header like the SPA. */
function session() {
  const cookies = new Map()
  async function call(method, url, body) {
    const headers = { 'content-type': 'application/json' }
    if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    if (cookies.has('semestra_csrf')) headers['x-semestra-csrf'] = cookies.get('semestra_csrf')
    const response = await fetch(`${origin}${url}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';')
      const at = pair.indexOf('=')
      cookies.set(pair.slice(0, at), pair.slice(at + 1))
    }
    if (!response.ok)
      throw new Error(`${method} ${url}: ${response.status} ${await response.text()}`)
    return response.status === 204 ? null : response.json()
  }
  return { cookies, post: (url, body) => call('POST', url, body) }
}

function signInCode(email) {
  let lines = []
  try {
    lines = readFileSync(outbox, 'utf8').trim().split('\n')
  } catch {
    return null
  }
  for (const line of lines.reverse()) {
    const mail = JSON.parse(line)
    if (mail.to === email) return /\b(\d{6})\b/.exec(mail.text)?.[1] ?? null
  }
  return null
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

/** An account with enough data that every page has something to show. */
async function seed() {
  const http = session()
  const { email, password, name } = account
  await http.post('/auth/email/start', { email })
  let code = null
  for (let i = 0; i < 40 && !code; i++) {
    code = signInCode(email)
    if (!code) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!code) throw new Error('no sign-in code in the outbox')
  const verified = await http.post('/auth/email/verify', { email, code })
  await http.post('/auth/register/complete', {
    registration_token: verified.registration_token,
    display_name: name,
    // spec.ts signs back in with it after a random click signs out.
    password,
  })

  const program = await http.post('/programs', {
    name: 'Computer Engineering',
    institution: 'University of Toronto',
    timezone: 'America/Toronto',
  })
  const today = new Date()
  const { term, course_ids: courses } = await http.post(`/programs/${program.id}/terms`, {
    name: 'This term',
    start_date: isoDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
    end_date: isoDate(new Date(today.getFullYear(), today.getMonth() + 2, 15)),
    courses: [
      { code: 'APS105H1', title: 'Computer Fundamentals' },
      { code: 'MAT188H1', title: 'Linear Algebra' },
      { code: 'ECE110H1', title: 'Electrical Fundamentals' },
    ],
  })
  const inDays = (days) => isoDate(new Date(today.getTime() + days * 86_400_000))
  await http.post(`/courses/${courses[0]}/assessments:batch`, {
    assessments: [
      { title: 'Lab 1', weight: 10, score_percentage: 92, due_date: inDays(-14) },
      { title: 'Midterm', weight: 30, score_percentage: 78, due_date: inDays(-3) },
      { title: 'Lab 2', weight: 10, due_date: inDays(4) },
      { title: 'Final exam', weight: 50, due_date: inDays(30) },
    ],
  })
  for (const [title, course, due] of [
    ['Read chapter 3', courses[1], inDays(1)],
    ['Problem set 4', courses[2], inDays(2)],
    ['Email the TA', null, null],
  ]) {
    await http.post(`/programs/${program.id}/tasks`, {
      title,
      course_id: course,
      term_id: course ? term.id : null,
      due_date: due,
    })
  }
  return http.cookies
}

// Another server on the port would answer the readiness check and get the seed data instead.
const taken = await fetch(`${origin}/readyz`).then(
  () => true,
  () => false,
)
if (taken) {
  console.error(`Something already listens on ${origin}; stop it or set BOMBADIL_PORT.`)
  process.exit(1)
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130))

const migrate = await exited(
  uv(['alembic', '-c', path.join(api, 'alembic.ini'), 'upgrade', 'head'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  }),
)
if (migrate !== 0) process.exit(migrate)
const server = uv(['semestra', 'serve', '--host', '127.0.0.1', '--port', String(port)], {
  stdio: ['ignore', 'ignore', 'inherit'],
})
const serverExited = exited(server)
process.on('exit', () => server.exitCode === null && server.kill('SIGTERM'))
await waitUntilReady(server)
const cookies = await seed()

const bombadil = spawn(
  'bombadil',
  [
    'browser',
    'test',
    `${origin}/`,
    path.join(here, 'spec.ts'),
    '--headless',
    '--exit-on-violation',
    '--time-limit',
    values['time-limit'],
    '--output-path',
    output,
    ...[...cookies].flatMap(([name, value]) => ['--cookie', `${name}=${value}`]),
    ...passThrough,
  ],
  { cwd: web, stdio: 'inherit' },
)
const status = await exited(bombadil)
// Let the port go before returning, so a run right after this one can take it.
server.kill('SIGTERM')
await serverExited
// Bombadil's own "Reproduce this test" line needs this instance, which is gone by now; replays
// rarely line up anyway (React's generated element ids differ between runs).
if (status === 2) console.log(`Trace and screenshots: ${path.relative(web, output)}`)
process.exit(status)
