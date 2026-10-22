import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

// The marketing site: static HTML, no client framework at runtime. React is only used at build time
// to render the shadcn components (Button, NavigationMenu) the app also uses.
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? 'https://semestra.jyleo.cc',
  // Served under /landing on the app's origin (see apps/site/README.md).
  base: '/landing',
  integrations: [react()],
  i18n: {
    locales: ['en', { path: 'zh', codes: ['zh-CN'] }],
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: false },
  },
  vite: { plugins: [tailwindcss()] },
})
