// Runs the Bombadil specification (spec.ts) against a throwaway instance: the API serves the
// built SPA on one origin, as the all-in-one image does, with a fresh data directory. The demo
// account of `pnpm dev:demo` (apps/api/devtools/seed.py) is created over HTTP, and Bombadil starts
// from `/` with its session cookies.
//
//   pnpm --filter @semestra/web bombadil [-- <bombadil options>]
//
// Options go to `bombadil browser test`, e.g. `--time-limit 10m` (default 2m) or
// `--width 375 --height 812` (the phone layout). Each run writes its trace and screenshots to
// bombadil/.runs/<time>/; `pnpm exec bombadil browser inspect <dir>` shows them step by step.
// The exit code is Bombadil's: 0 nothing failed, 2 a property failed, 1 something else went wrong.
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
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

/**
 * The shared demo account (apps/api/devtools/seed.py: a Program with three terms, courses,
 * sections, gradebooks, events and tasks), created over HTTP; returns its session cookies.
 */
async function seed() {
  const child = uv(
    [
      'python',
      '-m',
      'devtools',
      'seed',
      '--origin',
      origin,
      '--outbox',
      outbox,
      '--email',
      account.email,
      // spec.ts signs back in with it after a random click signs out.
      '--password',
      account.password,
      '--name',
      account.name,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  let printed = ''
  child.stdout.on('data', (chunk) => (printed += chunk))
  const code = await exited(child)
  if (code !== 0) throw new Error(`seeding failed (${code})`)
  const made = JSON.parse(printed.trim().split('\n').at(-1))
  return new Map(Object.entries(made.cookies))
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
