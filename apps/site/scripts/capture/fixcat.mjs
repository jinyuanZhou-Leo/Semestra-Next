import { API, OUT, WEB, launch } from './env.mjs'
import { readFileSync } from 'node:fs'
const ids = JSON.parse(readFileSync(OUT + '/ids.json', 'utf8'))
const b = await launch()
const ctx = await b.newContext({ storageState: OUT + '/state.json' })
const p = await ctx.newPage()
await p.goto(WEB + '/')
const csrf = (await ctx.cookies()).find((c) => c.name === 'semestra_csrf')?.value
const gb = await (await p.request.get(`${API}/courses/${ids.courses.ECE244H1}/gradebook`)).json()
const colors = { Labs: 'cyan', Quizzes: 'blue', Midterm: 'amber', 'Final exam': 'violet' }
for (const c of gb.categories) {
  const r = await p.request.patch(API + '/grading-categories/' + c.id, {
    data: { color: colors[c.name] },
    headers: { 'X-Semestra-CSRF': csrf },
  })
  console.log(c.name, r.status())
}
await b.close()
