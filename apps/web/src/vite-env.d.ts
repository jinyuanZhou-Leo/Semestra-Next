/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string
  readonly VITE_DOCS_URL?: string
  readonly VITE_EMAIL_DOMAINS?: string
  readonly VITE_LANDING_URL?: string
  readonly VITE_SENTRY_DSN?: string
}

/** Injected by Vite (`define` in vite.config.ts and vitest.config.ts). */
declare const SEMESTRA_VERSION: string
declare const SEMESTRA_BUILD_TIME: string
