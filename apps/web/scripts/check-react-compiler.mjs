// Fails when React Compiler skips a component or hook (M00 §4.1). Vite compiles with
// `panicThreshold: 'none'`, so a violation of the Rules of React (ref read/written during render,
// setState during render, mutated props or state...) silently falls back to uncompiled code.
// This runs the same compiler (Oxc's native port, as in `vite.config.ts`) over `src` and reports
// every diagnostic; with `panicThreshold: 'none'` each one means a function was left uncompiled.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { transform } from 'oxc-transform-react'

const root = path.resolve(import.meta.dirname, '../src')
const skip = new Set(['ui', 'ai-elements', 'paraglide', 'generated'])

// Functions that are meant to stay uncompiled. Keep each reason next to the entry.
const allowed = [
  // Call a hook per registered module/contribution; the list is fixed while mounted.
  ['app/commands/CommandPalette.tsx', 'Hooks must be called at the top level'],
  ['app/host/StatusBar.tsx', 'Hooks must be the same function'],
  // Refs hold the latest closures for timers that outlive a render.
  ['app/settings/autosave.ts', 'PruneHoistedContexts'],
  // TanStack Virtual's virtualizer is a mutable object; the compiler skips it on purpose.
  ['modules/tasks/components/VirtualTaskList.tsx', 'Use of incompatible library'],
  ['modules/files/components/VirtualBody.tsx', 'Use of incompatible library'],
]

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) yield* files(path.join(dir, entry.name))
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|gen)\.tsx?$/.test(entry.name)) {
      yield path.join(dir, entry.name)
    }
  }
}

// Same options as `react({ compiler })` in `vite.config.ts`.
const compilerOptions = { eslintSuppressionRules: [], reportDiagnostics: true }

const failures = []
let memoized = 0
let checked = 0
await Promise.all(
  [...files(root)].map(async (file) => {
    const source = readFileSync(file, 'utf8')
    const result = await transform(file, source, { reactCompiler: compilerOptions })
    checked += 1
    // Every compiled function that caches anything starts with `const $ = _c(n)`.
    memoized += result.code.match(/\b_c\d*\(\d+\)/g)?.length ?? 0
    const name = path.relative(root, file)
    for (const error of result.errors) {
      const start = error.labels[0]?.start
      const line = start === undefined ? 0 : source.slice(0, start).split('\n').length
      if (allowed.some(([f, text]) => f === name && error.message.includes(text))) continue
      failures.push(`${name}:${line}  ${error.message}`)
    }
  }),
)

if (failures.length > 0) {
  console.error(`React Compiler left code uncompiled (${failures.length} diagnostic(s)):\n${failures.join('\n')}`)
  process.exit(1)
}
console.log(
  `React Compiler: ${checked} files, ${memoized} functions memoized, none skipped.`,
)
