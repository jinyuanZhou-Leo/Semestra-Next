// Shared settings for the capture scripts. Override with environment variables when needed.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(here, '../../../..')
export const OUT = process.env.CAPTURE_OUT ?? resolve(here, '.out')
export const API = process.env.CAPTURE_API ?? 'http://localhost:8000'
export const WEB = process.env.CAPTURE_WEB ?? 'http://localhost:5173'
mkdirSync(OUT + '/out', { recursive: true })

// Uses Playwright's Chromium unless CHROMIUM_PATH points at another build.
export const launch = () =>
  chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})

// The page tells the story of Wednesday 2026-10-21 in Toronto; the app's "now" is pinned to 08:40 that day.
export const NOW = new Date(process.env.CAPTURE_NOW ?? '2026-10-21T12:40:00Z')
