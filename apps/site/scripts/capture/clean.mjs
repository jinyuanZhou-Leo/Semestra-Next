// Resets what the Sem chat leaves behind: its sessions, and the task its approved proposal added.
import { readFileSync } from 'node:fs'
import { API, OUT, WEB, launch } from './env.mjs'

const ids = JSON.parse(readFileSync(OUT + '/ids.json', 'utf8'))
const b = await launch()
const ctx = await b.newContext({ storageState: OUT + '/state.json' })
const p = await ctx.newPage()
await p.goto(WEB + '/')
const headers = {
  'X-Semestra-CSRF': (await ctx.cookies()).find((c) => c.name === 'semestra_csrf')?.value,
}
const list = async (path) => {
  const r = await (await p.request.get(API + path)).json()
  return r.items ?? r
}
const sessions = await list('/agent/sessions')
for (const s of sessions) await p.request.delete(API + '/agent/sessions/' + s.id, { headers })
const tasks = (await list(`/programs/${ids.prog}/tasks?limit=200`)).filter((t) =>
  /2025/.test(t.title),
)
for (const t of tasks) await p.request.delete(API + '/tasks/' + t.id, { headers })
console.log('deleted', sessions.length, 'sessions', tasks.length, 'tasks')
await b.close()
