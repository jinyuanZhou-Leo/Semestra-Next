// Fails when a locale is missing keys that exist in another locale (M00 §4.5), or when a key is
// used nowhere in `src` outside tests (keys looked up by prefix, see message-groups.mjs, count as
// used).
import { readFileSync, readdirSync } from 'node:fs'
import { GROUPS } from './message-groups.mjs'

const dir = new URL('../messages/', import.meta.url)
const locales = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f, new Set(Object.keys(JSON.parse(readFileSync(new URL(f, dir), 'utf8'))))]),
)
const all = new Set(Object.values(locales).flatMap((s) => [...s]))
let bad = false
for (const [file, keys] of Object.entries(locales)) {
  const missing = [...all].filter((k) => !keys.has(k))
  if (missing.length) {
    bad = true
    console.error(`${file} is missing: ${missing.join(', ')}`)
  }
}

const src = new URL('../src/', import.meta.url)
const skip = /^(paraglide|lib\/message-groups)\/|\.test\.|(^|\/)test-/
const words = new Set()
for (const file of readdirSync(src, { recursive: true })) {
  if (!/\.tsx?$/.test(file) || skip.test(file)) continue
  for (const word of readFileSync(new URL(file, src), 'utf8').match(/\w+/g) ?? []) words.add(word)
}
const prefixes = GROUPS.map((group) => group.prefix)
const unused = [...all].filter(
  (k) => !k.startsWith('$') && !words.has(k) && !prefixes.some((p) => k.startsWith(p)),
)
if (unused.length) {
  bad = true
  console.error(`Not used in src: ${unused.join(', ')}`)
}
process.exit(bad ? 1 : 0)
