// Connects Maya's account to the stand-in Canvas (canvas.py) and links her fall courses. ECE244's
// assessments are bound to their Canvas assignments, so only what was posted since shows as new.
import { readFileSync } from 'node:fs'
import { API, OUT, WEB, launch } from './env.mjs'

const ids = JSON.parse(readFileSync(OUT + '/ids.json', 'utf8'))
const b = await launch()
const ctx = await b.newContext({ storageState: OUT + '/state.json' })
const p = await ctx.newPage()
await p.goto(WEB + '/')
const csrf = (await ctx.cookies()).find((c) => c.name === 'semestra_csrf')?.value
const api = async (method, path, data) => {
  const r = await p.request.fetch(API + path, {
    method,
    data,
    headers: { 'X-Semestra-CSRF': csrf },
  })
  const t = await r.text()
  if (!r.ok()) throw new Error(`${method} ${path} ${r.status()} ${t}`)
  return t && JSON.parse(t)
}

// The Canvas tab is a plugin.
await api('PUT', '/plugins/canvas-tab/installation', {})

const connection = await api('POST', '/lms/connections', {
  provider: 'canvas',
  display_name: 'Quercus',
  config: { base_url: 'http://127.0.0.1:9998' },
  credentials: { access_token: 'capture-token-0000' },
})
await api('PUT', `/programs/${ids.prog}/lms-binding`, { connection_id: connection.id })
const canvas = { ECE244H1: 101, MAT290H1: 102, ECE216H1: 103, ECE231H1: 104, ECE297H1: 105 }
for (const [code, external] of Object.entries(canvas))
  await api('PUT', `/courses/${ids.courses[code]}/lms-link`, {
    external_course_id: String(external),
  })

const assignments = {
  'Lab 1': 24401,
  'Lab 2': 24402,
  'Lab 3': 24403,
  'Lab 4': 24404,
  'Lab 5': 24405,
}
Object.assign(assignments, { 'Lab 6': 24406, 'Quiz 1': 24411, 'Quiz 2': 24412 })
Object.assign(assignments, { Midterm: 24421, 'Final exam': 24422 })
const gradebook = await api('GET', `/courses/${ids.courses.ECE244H1}/gradebook`)
for (const a of gradebook.assessments ?? gradebook.categories.flatMap((c) => c.assessments)) {
  const id = assignments[a.title]
  if (id) await api('PUT', `/assessments/${a.id}/lms-assignment`, { assignment_id: String(id) })
}
console.log('lms', connection.id)
await b.close()
