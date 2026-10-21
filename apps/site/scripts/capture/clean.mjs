import { API, OUT, WEB, launch } from './env.mjs'
const b = await launch()
const ctx = await b.newContext({ storageState: OUT + '/state.json' })
const p = await ctx.newPage()
await p.goto(WEB + '/')
const csrf = (await ctx.cookies()).find((c) => c.name === 'semestra_csrf')?.value
const r = await (await p.request.get(API + '/agent/sessions')).json()
for (const s of r.items ?? r)
  await p.request.delete(API + '/agent/sessions/' + s.id, { headers: { 'X-Semestra-CSRF': csrf } })
console.log('deleted', (r.items ?? r).length)
await b.close()
