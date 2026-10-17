import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'pnpm --dir ../.. --filter @semestra/api migrate && pnpm --dir ../.. dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
