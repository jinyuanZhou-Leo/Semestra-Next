// Turns the captures in .out/ into the images the site serves. run.mjs ends with this; run it alone
// after re-taking a single capture.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { OUT } from './env.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// <name>-<scheme>-<locale>.png → public/shots/<name>-<scheme>-<en|zh>.webp, 2000 px wide.
const dest = resolve(here, '../../public/shots')
const keep = new Set(['today'])
for (const f of readdirSync(OUT + '/out')) {
  const m = /^(.+)-(light|dark)-(en-US|zh-CN)\.png$/.exec(f)
  if (!m || !keep.has(m[1])) continue
  const out = `${dest}/${m[1]}-${m[2]}-${m[3].slice(0, 2)}.webp`
  await sharp(`${OUT}/out/${f}`).resize({ width: 2000 }).webp({ quality: 82 }).toFile(out)
  console.log(out)
}

// The README's screenshots → docs/assets/screenshots/<name>[-zh]-<scheme>.webp, 2160 px wide. Sem's
// conversation is the README's "assistant".
const readme = resolve(here, '../../../../docs/assets/screenshots')
const names = { today: 'today', academics: 'academics', schedule: 'schedule', grades: 'grades' }
Object.assign(names, { tasks: 'tasks', plugins: 'plugins', sem: 'assistant' })
for (const f of readdirSync(OUT + '/out')) {
  const m = /^(.+)-(light|dark)-(en-US|zh-CN)\.png$/.exec(f)
  if (!m || !names[m[1]]) continue
  const out = `${readme}/${names[m[1]]}${m[3] === 'zh-CN' ? '-zh' : ''}-${m[2]}.webp`
  await sharp(`${OUT}/out/${f}`).resize({ width: 2160 }).webp({ quality: 82 }).toFile(out)
  console.log(out)
}

// The clips (video.mjs) are already encoded: copy them to public/clips/<name>-<scheme>-<en|zh>.mp4,
// and their timings to src/clips.json, where the page lines its captions up with them.
const clips = resolve(here, '../../public/clips')
mkdirSync(clips, { recursive: true })
const timings = {}
// Sem's clip plays in the dark band, so only its dark version is served.
const unused = new Set(['sem-light'])
for (const f of existsSync(OUT + '/clips') ? readdirSync(OUT + '/clips').sort() : []) {
  const m = /^(.+)-(light|dark)-(en-US|zh-CN)\.(mp4|json)$/.exec(f)
  if (!m || unused.has(`${m[1]}-${m[2]}`)) continue
  const key = `${m[1]}-${m[2]}-${m[3].slice(0, 2)}`
  if (m[4] === 'mp4') copyFileSync(`${OUT}/clips/${f}`, `${clips}/${key}.mp4`)
  else timings[key] = JSON.parse(readFileSync(`${OUT}/clips/${f}`, 'utf8'))
}
if (Object.keys(timings).length)
  writeFileSync(resolve(here, '../../src/clips.json'), JSON.stringify(timings, null, 2) + '\n')

// Pieces of the UI (parts.mjs, and the proposal from chat.mjs) → public/parts/, at most
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
