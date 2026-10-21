import { createGetUrl } from 'fumadocs-core/source'
import { i18n } from './i18n'

export const appName = 'Semestra'
export const docsRoute = '/docs'
export const docsImageRoute = '/og/docs'
export const docsContentRoute = '/llms.mdx/docs'

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
