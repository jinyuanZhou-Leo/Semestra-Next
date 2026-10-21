// Fails when React Compiler skips a component or hook (M00 §4.1). Vite compiles with
// `panicThreshold: 'none'`, so a violation of the Rules of React (ref read/written during render,
// setState during render, mutated props or state...) silently falls back to uncompiled code.
// This runs the same compiler over `src` and reports every bail-out.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { transformSync } from '@babel/core'
import reactCompiler from 'babel-plugin-react-compiler'

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

const failures = []
let compiled = 0
for (const file of files(root)) {
  transformSync(readFileSync(file, 'utf8'), {
    filename: file,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['jsx', 'typescript'] },
    plugins: [
      [
        reactCompiler,
        {
          logger: {
            logEvent(_, event) {
              if (event.kind === 'CompileSuccess') compiled += 1
              else if (event.kind === 'CompileError' || event.kind === 'CompileSkip') {
                const detail = event.detail
                const line =
                  (typeof detail?.loc === 'object' ? detail.loc?.start.line : undefined) ??
                  detail?.details?.[0]?.loc?.start.line ??
                  event.fnLoc?.start.line ??
                  0
                const reason = detail?.reason ?? event.reason ?? event.kind
                const name = path.relative(root, file)
                if (allowed.some(([f, text]) => f === name && reason.includes(text))) return
                failures.push(`${name}:${line}  ${reason}`)
              }
            },
          },
        },
      ],
    ],
  })
}

if (failures.length > 0) {
  console.error(`React Compiler skipped ${failures.length} function(s):\n${failures.join('\n')}`)
  process.exit(1)
}
console.log(`React Compiler: ${compiled} functions compiled, none skipped.`)
