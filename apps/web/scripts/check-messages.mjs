// Fails when a locale is missing keys that exist in another locale (M00 §4.5), when a key is
// used nowhere in `src` outside tests (keys looked up by prefix, see message-groups.mjs, count as
// used), or when the Chinese text uses a translation the owner replaced with the product's term.
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
// The Chinese UI keeps these names as they are in English, and uses consistent wording.
const replaced = {
  学业项目: 'Program',
  教学班: 'Section',
  学习平台: 'LMS',
  删掉: '删除',
}
const en = JSON.parse(readFileSync(new URL('en.json', dir), 'utf8'))
const zh = JSON.parse(readFileSync(new URL('zh-CN.json', dir), 'utf8'))
const placeholders = (text) =>
  [...new Set([...String(text).matchAll(/\{([a-zA-Z0-9_]+)(?:,[^}]*)?\}/g)].map((m) => m[1]))].sort()

for (const [key, text] of Object.entries(zh)) {
  if (key.startsWith('$') || typeof text !== 'string') continue
  for (const [term, name] of Object.entries(replaced)) {
    if (text.includes(term)) {
      bad = true
      console.error(`zh-CN.json ${key}: write "${name}", not "${term}"`)
    }
  }
  if (key.startsWith('error_lms_') && text.includes('平台')) {
    bad = true
    console.error(`zh-CN.json ${key}: write "LMS", not "平台"`)
  }
  if (/[\u4e00-\u9fff]\{|\}[\u4e00-\u9fff]/.test(text)) {
    bad = true
    console.error(`zh-CN.json ${key}: add a space between Chinese characters and {placeholder}`)
  }
  if (typeof en[key] === 'string') {
    const enVars = placeholders(en[key])
    const zhVars = placeholders(text)
    if (enVars.join(',') !== zhVars.join(',')) {
      bad = true
      console.error(`${key}: placeholder mismatch (en: [${enVars}], zh-CN: [${zhVars}])`)
    }
  }
}
process.exit(bad ? 1 : 0)
