import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { paraglideVitePlugin } from '@inlang/paraglide-js'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { type Plugin, defineConfig, normalizePath } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const { version } = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8'),
) as {
  version: string
}

// The PDF previewer (M07) needs pdf.js's character maps (CJK fonts) and standard fonts as files.
const pdfjsDir = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))

// The Latin subsets of the two fonts load with the entry instead of when the first text renders,
// which also spares a relayout when they swap in. Other subsets (CJK uses system fonts) stay lazy.
const PRELOAD_FONTS = /^assets\/(inter|figtree)-latin-wght-normal-[\w-]+\.woff2$/

function preloadFonts(): Plugin {
  return {
    name: 'semestra:preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (_html, { bundle }) =>
        Object.keys(bundle ?? {})
          .filter((file) => PRELOAD_FONTS.test(file))
          .map((file) => ({
            tag: 'link',
            attrs: {
              rel: 'preload',
              as: 'font',
              type: 'font/woff2',
              href: `/${file}`,
              crossorigin: '',
            },
            injectTo: 'head' as const,
          })),
    },
  }
}

// Stable third-party chunks. Rolldown otherwise cuts shared code into many small chunks named after
// whatever happens to share them, and every release renames them. A group's chunk is downloaded
// whole by whichever page imports any of its modules, so each group holds only packages used by
// the same set of pages. Hashes of these chunks change only when the dependency does: a release
// then makes returning users download the app's own code, not React again.
const nodeModules = (packages: string) => new RegExp(`node_modules[\\\\/](${packages})[\\\\/]`)
const vendorGroups = [
  // Needed by every page, the sign-in page too.
  { name: 'vendor-react', test: nodeModules('react|react-dom|scheduler|use-sync-external-store') },
  {
    name: 'vendor-core',
    test: nodeModules(
      '@tanstack[\\\\/](?:router-core|history|react-router|query-core|react-query|query-persist-client-core|store|react-store)|idb-keyval|sonner|semver|class-variance-authority|clsx',
    ),
  },
  // Base UI's positioning engine and shared utilities: every popup and the sign-in page use them.
  // Its components stay with the pages that use them: Combobox, Menu and Select are not for sign-in.
  {
    name: 'vendor-floating',
    test: nodeModules('@floating-ui[\\\\/][^\\\\/]+|@base-ui[\\\\/]utils'),
  },
  // Icons that two or more chunks share (one chunk per icon was the alternative); the rest stay
  // inside the chunk that uses them.
  { name: 'vendor-icons', test: nodeModules('lucide-react'), minShareCount: 2 },
  // The signed-in shell: sidebar pins, assistant dock, shortcuts and tables.
  {
    name: 'vendor-shell',
    test: nodeModules(
      '@dnd-kit[\\\\/][^\\\\/]+|react-resizable-panels|react-hotkeys-hook|@tanstack[\\\\/](?:table-core|react-table)',
    ),
  },
  // The card boards (Today, term and course overview).
  { name: 'vendor-board', test: nodeModules('react-grid-layout|react-draggable|react-resizable') },
].map((group, index, all) => ({ ...group, priority: all.length - index }))

export default defineConfig({
  define: {
    // Shown on the settings "About" section.
    SEMESTRA_VERSION: JSON.stringify(version),
    SEMESTRA_BUILD_TIME: JSON.stringify(new Date().toISOString()),
  },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  plugins: [
    // The router plugin must come before the React plugin. Tests next to route files are not routes.
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routeFileIgnorePattern: '\\.test\\.tsx?$',
    }),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      emitTsDeclarations: true,
      strategy: ['localStorage', 'preferredLanguage', 'baseLocale'],
    }),
    // React Compiler runs natively (Oxc's Rust port, `oxc-transform-react`) instead of through Babel.
    // `oxlint-disable … react-hooks/*` comments do not opt a function out: Babel's compiler only
    // reads `eslint-disable`, and the few effects that skip a dependency on purpose stay compiled.
    react({ compiler: { eslintSuppressionRules: [] } }),
    tailwindcss(),
    preloadFonts(),
    viteStaticCopy({
      targets: ['cmaps', 'standard_fonts', 'wasm', 'iccs'].map((dir) => ({
        src: `${normalizePath(path.join(pdfjsDir, dir))}/*`,
        dest: `pdfjs/${dir}`,
        rename: { stripBase: true },
      })),
    }),
  ],
  build: {
    rolldownOptions: { output: { codeSplitting: { groups: vendorGroups } } },
  },
  server: { port: 5173 },
})
