import { API, OUT, WEB, launch } from './env.mjs'
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
  if (!r.ok()) throw new Error(path + ' ' + r.status() + ' ' + t)
  return t && JSON.parse(t)
}
const prov = await api('POST', '/ai/providers', {
  kind: 'openai_compatible',
  display_name: 'Demo',
  base_url: 'http://127.0.0.1:9999/v1',
  api_key: 'demo-key',
  capabilities: ['chat', 'tools', 'structured'],
})
for (const purpose of ['chat', 'title', 'extraction'])
  await api('PUT', '/ai/assignments', { purpose, provider_id: prov.id, model: 'gpt-5.5' })
console.log('ok', prov.id)
await b.close()
