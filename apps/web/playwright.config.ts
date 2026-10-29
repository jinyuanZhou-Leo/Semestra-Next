import path from 'node:path'
import { defineConfig } from '@playwright/test'

// Three ways to run:
// - E2E_BASE_URL: an instance that is already running (it must write emails to E2E_OUTBOX);
// - E2E_BUILT=1 (CI): the API serves the built SPA (`pnpm build` with VITE_API_ORIGIN='') on one
//   origin, as the all-in-one image does, with a fresh data directory;
// - neither: the dev servers (`pnpm dev`), started unless already running.
const external = process.env.E2E_BASE_URL
const built = !external && process.env.E2E_BUILT === '1'
const api = path.resolve(import.meta.dirname, '../api')
const dataDir = built ? path.resolve(import.meta.dirname, 'e2e/.data') : path.join(api, 'data')
// Outside prod the API appends every email to <data dir>/dev-outbox.jsonl; the specs read the
// sign-in codes from it. Workers inherit this.
process.env.E2E_OUTBOX ??= path.join(dataDir, 'dev-outbox.jsonl')

const origin = 'http://localhost:8000'
const builtEnv = {
  // Not whatever apps/api/.env says: prod writes no outbox, and resend would send real email.
  SEMESTRA_ENV: 'dev',
  SEMESTRA_EMAIL_BACKEND: 'console',
  SEMESTRA_DATA_DIR: dataDir,
  SEMESTRA_DATABASE_URL: `sqlite+aiosqlite:///${dataDir}/semestra.db`,
  SEMESTRA_STORAGE_LOCAL_ROOT: path.join(dataDir, 'storage'),
  SEMESTRA_SERVE_WEB: 'true',
  SEMESTRA_WEB_DIST_DIR: path.resolve(import.meta.dirname, 'dist'),
  SEMESTRA_PUBLIC_WEB_ORIGIN: origin,
  SEMESTRA_PUBLIC_API_ORIGIN: origin,
  SEMESTRA_CORS_ORIGINS: JSON.stringify([origin]),
}

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: external ?? (built ? origin : 'http://localhost:5173'),
    trace: 'retain-on-failure',
  },
  webServer: external
    ? undefined
    : built
      ? {
          command: `rm -rf "${dataDir}" && uv run --project "${api}" alembic -c "${api}/alembic.ini" upgrade head && uv run --project "${api}" semestra serve --host 127.0.0.1 --port 8000`,
          cwd: api,
          env: builtEnv,
          url: `${origin}/readyz`,
          reuseExistingServer: false,
          timeout: 120_000,
        }
      : {
          command: 'pnpm --dir ../.. --filter @semestra/api migrate && pnpm --dir ../.. dev',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
          timeout: 60_000,
        },
})
