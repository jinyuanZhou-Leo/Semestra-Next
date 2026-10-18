import { defineConfig } from '@playwright/test'

// E2E_BASE_URL points the suite at an already running instance (e.g. the all-in-one image
// in CI); without it Playwright starts the dev servers itself.
const external = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: external ?? 'http://localhost:5173' },
  webServer: external
    ? undefined
    : {
        command: 'pnpm --dir ../.. --filter @semestra/api migrate && pnpm --dir ../.. dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 60_000,
      },
})
