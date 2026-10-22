import { defineI18n } from 'fumadocs-core/i18n'

export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'zh'],
  // `page.zh.mdx` next to `page.mdx`; pages without a translation (the generated API
  // reference) fall back to English.
  parser: 'dot',
})

export type Lang = (typeof i18n.languages)[number]
