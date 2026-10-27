import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import babel from '@rolldown/plugin-babel'
import { paraglideVitePlugin } from '@inlang/paraglide-js'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig, normalizePath } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const { version } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')) as {
  version: string
}

// The PDF previewer (M07) needs pdf.js's character maps (CJK fonts) and standard fonts as files.
const pdfjsDir = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))

export default defineConfig({
  define: {
    // Shown on the settings "About" section.
    SEMESTRA_VERSION: JSON.stringify(version),
    SEMESTRA_BUILD_TIME: JSON.stringify(new Date().toISOString()),
  },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  plugins: [
    // The router plugin must come before the React plugin. Tests next to route files are not routes.
    tanstackRouter({ target: 'react', autoCodeSplitting: true, routeFileIgnorePattern: '\\.test\\.tsx?$' }),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      emitTsDeclarations: true,
      strategy: ['localStorage', 'preferredLanguage', 'baseLocale'],
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    viteStaticCopy({
      targets: ['cmaps', 'standard_fonts', 'wasm', 'iccs'].map((dir) => ({
        src: `${normalizePath(path.join(pdfjsDir, dir))}/*`,
        dest: `pdfjs/${dir}`,
        rename: { stripBase: true },
      })),
    }),
  ],
  server: { port: 5173 },
})
