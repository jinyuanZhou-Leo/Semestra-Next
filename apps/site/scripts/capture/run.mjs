// Captures every product shot the site shows, from the real app, in both languages and themes.
// Needs: a fresh local database, the API (with its clock pinned, see README) and the web dev server,
// the scripted model (`python3 server.py`) on 127.0.0.1:9999 and the stand-in Canvas
// (`python3 canvas.py`) on 127.0.0.1:9998. See README.md.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OUT } from './env.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const node = (script, ...args) =>
  execFileSync(process.execPath, [resolve(here, script), ...args], { stdio: 'inherit' })

if (!existsSync(OUT + '/ids.json')) {
  node('seed.mjs')
  node('fixcat.mjs')
  node('ai.mjs')
  node('lecture.mjs')
}
const ask = {
  'en-US': 'Help me prep for the ECE216 midterm around my other deadlines.',
  'zh-CN': '帮我在其他截止日期之间安排 ECE216 期中复习。',
}
const combos = ['light', 'dark'].flatMap((scheme) =>
  ['en-US', 'zh-CN'].map((locale) => [scheme, locale]),
)
// Pages first: approving Sem's proposal adds a task, which must not show up in the other shots.
for (const [scheme, locale] of combos) {
  node('cap.mjs', scheme, locale)
  node('parts.mjs', scheme, locale)
}
for (const [scheme, locale] of combos) {
  node('clean.mjs')
  execFileSync(process.execPath, [resolve(here, 'chat.mjs'), scheme, locale, ask[locale], 'sem'], {
    stdio: 'inherit',
    env: { ...process.env, APPROVE: '1' },
  })
}
// The LMS last: once it is connected, its new-assignments toast shows up on every page.
node('lms.mjs')
for (const [scheme, locale] of combos) node('lmsparts.mjs', scheme, locale)

await import('./convert.mjs')
