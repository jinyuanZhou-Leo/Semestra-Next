// Keeps the first load small (M00 §4.1). `src/app/registry.ts` imports every module manifest, so
// whatever a manifest imports statically, directly or through other files, is downloaded and
// parsed before the sign-in page can show. One import of a barrel file once pulled the whole
// settings framework and its drag-and-drop library in; CI does not build, so nothing noticed.
//
// This walks the static imports from the registry (`import()` and `import type` do not count) and
// fails when they reach something that must load on demand, printing the chain of imports that got
// there. The fix is nearly always one of:
//   - load the component with `preloadable()` (`src/app/extensions.ts`);
//   - import the constant or small function from a file of its own, not from a component's file
//     or a barrel (`@/app/settings` → `@/app/settings/rows`).
// When something does belong in the first load, add it to a list below and say why.
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { transform } from 'oxc-transform-react'

const src = path.resolve(import.meta.dirname, '../src')
const entry = 'app/registry.ts'

// Packages the first load may use. A package missing here is either heavy (charts, tables, the
// editor, PDF, drag and drop: load what uses it on demand) or new to the first load (add it).
const packages = new Set([
  '@base-ui/react',
  '@date-fns/tz',
  '@semestra/api-client',
  '@tanstack/react-query',
  '@tanstack/react-router',
  'class-variance-authority',
  'cn',
  'date-fns',
  'lucide-react',
  'react',
  'react-hotkeys-hook',
  'semver',
  // Named imports of single icons (a provider's logo).
  'simple-icons',
  'sonner',
])

// shadcn components the first load may use; each one brings its Base UI primitive with it.
const ui = new Set([
  'alert-dialog',
  'badge',
  'button',
  'checkbox',
  'dropdown-menu',
  'field',
  'input',
  'item',
  'label',
  'select',
  'separator',
  'textarea',
  'toggle',
  'toggle-group',
  'tooltip',
])

// Parts of the app that load on demand, as a whole.
const onDemand = [
  [
    /^app\/settings\/(?!rows\.tsx$|choice\.tsx$)/,
    'the settings framework (rows.tsx and choice.tsx are the light parts)',
  ],
  [
    /^app\/(host|board|commands)\/(.*\.tsx|index\.ts)$/,
    'the app shell (host, board, command palette)',
  ],
  [/^modules\/academics\/shell\/.*\.tsx$/, 'the desktop shell'],
  [/^modules\/[^/]+\/(pages|settings|mobile)\//, 'a page, settings section or phone page'],
]

const IMPORT = /(?:^|[\n;])\s*(?:import|export)\s(?:[^'"()]*?\sfrom\s*)?['"]([^'"]+)['"]/g

function resolve(from, spec) {
  const base = spec.startsWith('@/')
    ? path.join(src, spec.slice(2))
    : path.resolve(path.dirname(from), spec)
  for (const file of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(file) && statSync(file).isFile()) return file
  }
  return null
}

const rel = (file) => path.relative(src, file).split(path.sep).join('/')
/** Each file reached, with the file that imported it first. */
const parents = new Map()
const failures = []
const chain = (file) => {
  const steps = []
  for (let at = file; at; at = parents.get(at)) steps.push(rel(at))
  return steps.reverse().join('\n      → ')
}

const queue = [[path.join(src, entry), null]]
while (queue.length > 0) {
  const [file, parent] = queue.shift()
  if (parents.has(file)) continue
  parents.set(file, parent)
  const name = rel(file)
  const blocked = onDemand.find(([pattern]) => pattern.test(name))
  if (blocked) {
    failures.push(`${name} is part of ${blocked[1]}:\n      ${chain(file)}`)
    continue
  }
  if (name.startsWith('ui/') && !ui.has(name.slice(3).replace(/\.tsx?$/, ''))) {
    failures.push(`${name} is not among the components of the first load:\n      ${chain(file)}`)
    continue
  }
  if (!/\.tsx?$/.test(file)) continue
  // Stripping the types drops `import type` and type-only names, as the bundler does.
  const { code } = await transform(file, readFileSync(file, 'utf8'), {})
  for (const [, spec] of code.matchAll(IMPORT)) {
    if (spec.startsWith('.') || spec.startsWith('@/')) {
      // Compiled messages are per-message modules; the bundler keeps the ones used.
      if (spec.startsWith('@/paraglide/')) continue
      const to = resolve(file, spec)
      if (to) queue.push([to, file])
      else failures.push(`${name} imports ${spec}, which was not found`)
      continue
    }
    const pkg = spec
      .split('/')
      .slice(0, spec.startsWith('@') ? 2 : 1)
      .join('/')
    if (!packages.has(pkg)) {
      packages.add(pkg)
      failures.push(
        `${pkg} is not among the packages of the first load:\n      ${chain(file)}\n      → ${spec}`,
      )
    }
  }
}

if (failures.length > 0) {
  console.error(
    `The module manifests pull code into the first load that should load on demand ` +
      `(${failures.length}). Load it with preloadable(), or import the constant from a file of ` +
      `its own; see the top of scripts/check-entry.mjs.\n\n  ${failures.join('\n\n  ')}`,
  )
  process.exit(1)
}
console.log(`First load: ${parents.size} files reached from the module manifests, none on-demand.`)
