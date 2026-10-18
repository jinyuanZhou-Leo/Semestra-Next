import path from 'node:path'
import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: { SEMESTRA_VERSION: JSON.stringify('0.0.0-test'), SEMESTRA_BUILD_TIME: JSON.stringify('2026-01-01T00:00:00.000Z') },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  plugins: [
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      emitTsDeclarations: true,
      // localStorage first so tests can switch the language; empty storage means English.
      strategy: ['localStorage', 'baseLocale'],
    }),
  ],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: false,
  },
})
