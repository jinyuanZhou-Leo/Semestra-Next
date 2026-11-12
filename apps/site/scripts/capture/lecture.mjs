// Adds the lecture slides that the file preview shows to ECE216 (written by lecture.py).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API, OUT, REPO, WEB, launch } from './env.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ids = JSON.parse(readFileSync(OUT + '/ids.json', 'utf8'))
const pdf = OUT + '/Lecture 9 - The Laplace transform.pdf'
execFileSync(
  'uv',
  ['run', '--project', REPO + '/apps/api', 'python', resolve(here, 'lecture.py'), pdf],
  {
    stdio: 'inherit',
  },
)
const b = await launch()
const ctx = await b.newContext({ storageState: OUT + '/state.json' })
const p = await ctx.newPage()
await p.goto(WEB + '/')
const csrf = (await ctx.cookies()).find((c) => c.name === 'semestra_csrf')?.value
const r = await p.request.post(`${API}/courses/${ids.courses.ECE216H1}/files`, {
  headers: { 'X-Semestra-CSRF': csrf },
  multipart: {
    files: { name: pdf.split('/').pop(), mimeType: 'application/pdf', buffer: readFileSync(pdf) },
  },
})
if (!r.ok()) throw new Error(`upload ${r.status()} ${await r.text()}`)
// Give the file pipeline time to parse and index the slides.
await p.waitForTimeout(8000)
console.log('lecture uploaded')
await b.close()
