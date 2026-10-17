// Fails when a locale is missing keys that exist in another locale (M00 §4.5).
import { readFileSync, readdirSync } from 'node:fs'

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
process.exit(bad ? 1 : 0)
