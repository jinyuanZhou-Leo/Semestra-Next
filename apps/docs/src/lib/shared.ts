import { createGetUrl } from 'fumadocs-core/source'
import { i18n } from './i18n'

export const appName = 'Semestra'
// Next's `basePath` (next.config.mjs). Links through next/link get it on their own; plain URLs
// (fetches, metadata, the redirect page) add it themselves.
export const basePath = '/docs'
export const docsRoute = '/'
export const docsImageRoute = '/og'
export const docsContentRoute = '/llms.mdx'

const dev = process.env.NODE_ENV === 'development'
// The landing page and the app share the docs' origin in production; in development they run on
// their own dev servers.
export const landingUrl =
  process.env.NEXT_PUBLIC_LANDING_URL ?? (dev ? 'http://localhost:4321/landing' : '/landing')
export const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? (dev ? 'http://localhost:5173' : '')
export const siteUrl =
  process.env.SITE_URL ?? (dev ? 'http://localhost:3001' : 'https://semestra.jyleo.cc')

export const gitConfig = {
  user: 'jinyuanZhou-Leo',
  repo: 'Semestra-Next',
  branch: 'main',
  contentDir: 'apps/docs/content/docs',
}

const getContentUrl = createGetUrl(docsContentRoute, i18n)

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md']

  return { segments, url: getContentUrl(segments, page.locale) }
}

const getImageUrl = createGetUrl(docsImageRoute, i18n)

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png']

  return { segments, url: getImageUrl(segments, page.locale) }
}
