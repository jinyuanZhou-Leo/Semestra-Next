// Captures every product shot the site shows, from the real app, in both languages and themes.
// Needs: a fresh local database, `pnpm dev` running with SEMESTRA_ALLOW_PRIVATE_EGRESS=true, and the
// scripted model (`python3 server.py`) on 127.0.0.1:9999. See README.md.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { OUT } from './env.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const node = (script, ...args) =>
  execFileSync(process.execPath, [resolve(here, script), ...args], { stdio: 'inherit' })

if (!existsSync(OUT + '/ids.json')) {
  node('seed.mjs')
  node('fixcat.mjs')
  node('ai.mjs')
}
const ask = {
  'en-US': 'Help me prep for the ECE216 midterm around my other deadlines.',
  'zh-CN': '帮我在其他截止日期之间安排 ECE216 期中复习。',
}
const combos = ['light', 'dark'].flatMap((scheme) => ['en-US', 'zh-CN'].map((locale) => [scheme, locale]))
// Pages first: approving Sem's proposal adds a task, which must not show up in the other shots.
for (const [scheme, locale] of combos) node('cap.mjs', scheme, locale)
for (const [scheme, locale] of combos) {
  node('clean.mjs')
  execFileSync(process.execPath, [resolve(here, 'chat.mjs'), scheme, locale, ask[locale], 'sem'], {
    stdio: 'inherit',
    env: { ...process.env, APPROVE: '1' },
  })
}

// <name>-<scheme>-<locale>.png → public/shots/<name>-<scheme>-<en|zh>.webp, 2000 px wide.
const dest = resolve(here, '../../public/shots')
const keep = new Set(['today', 'calendar', 'tasks', 'grades', 'planfill', 'semcard', 'sem'])
for (const f of readdirSync(OUT + '/out')) {
  const m = /^(.+)-(light|dark)-(en-US|zh-CN)\.png$/.exec(f)
  if (!m || !keep.has(m[1])) continue
  const out = `${dest}/${m[1]}-${m[2]}-${m[3].slice(0, 2)}.webp`
  await sharp(`${OUT}/out/${f}`).resize({ width: 2000 }).webp({ quality: 82 }).toFile(out)
  console.log(out)
}
