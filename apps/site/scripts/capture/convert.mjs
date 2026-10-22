// Turns the captures in .out/ into the images the site serves. run.mjs ends with this; run it alone
// after re-taking a single capture.
import { mkdirSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { OUT } from './env.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// <name>-<scheme>-<locale>.png → public/shots/<name>-<scheme>-<en|zh>.webp, 2000 px wide.
const dest = resolve(here, '../../public/shots')
const keep = new Set(['today', 'sem'])
for (const f of readdirSync(OUT + '/out')) {
  const m = /^(.+)-(light|dark)-(en-US|zh-CN)\.png$/.exec(f)
  if (!m || !keep.has(m[1])) continue
  const out = `${dest}/${m[1]}-${m[2]}-${m[3].slice(0, 2)}.webp`
  await sharp(`${OUT}/out/${f}`).resize({ width: 2000 }).webp({ quality: 82 }).toFile(out)
  console.log(out)
}

// Pieces of the UI (parts.mjs, and the proposal and answer from chat.mjs) → public/parts/, at most
// 1600 px wide (they are captured at 2x).
const parts = resolve(here, '../../public/parts')
mkdirSync(parts, { recursive: true })
for (const f of readdirSync(OUT + '/parts')) {
  const m = /^(.+)-(light|dark)-(en-US|zh-CN)\.png$/.exec(f)
  if (!m) continue
  const out = `${parts}/${m[1]}-${m[2]}-${m[3].slice(0, 2)}.webp`
  await sharp(`${OUT}/parts/${f}`)
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toFile(out)
  console.log(out)
}
