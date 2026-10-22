import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

// The marketing site: static HTML, no client framework at runtime. React is only used at build time
// to render the shadcn components (Button, NavigationMenu) the app also uses.
export default defineConfig({
  site: 'https://semestra.app',
  integrations: [react()],
  i18n: {
    locales: ['zh-CN', 'en'],
    defaultLocale: 'zh-CN',
    routing: { prefixDefaultLocale: false },
  },
  vite: { plugins: [tailwindcss()] },
})
