import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { useUiPref } from '@/app/ui-pref'
import { API, renderWithRouter, server, user } from '@/test-utils'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function Probe() {
  const { signOut } = useAuth()
  const [sort, setSort] = useUiPref('tasks.sort', 'due')
  return (
    <>
      <button onClick={() => setSort('name')}>sort by name ({sort})</button>
      <button onClick={() => void signOut()}>leave</button>
    </>
  )
}

test('interface state changed just before signing out is saved while the session is still valid', async () => {
  const calls: string[] = []
  server.use(
    http.get(`${API}/account/me`, () => HttpResponse.json(user)),
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    http.put(`${API}/me/ui-state/:key`, async ({ request }) => {
      calls.push(`put ${JSON.stringify(await request.json())}`)
      return HttpResponse.json({ key: 'tasks.sort', value: 'name' })
    }),
    http.post(`${API}/auth/logout`, () => {
      calls.push('logout')
      return HttpResponse.json({ ok: true })
    }),
  )
  renderWithRouter(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )

  await userEvent.click(await screen.findByRole('button', { name: /sort by name/ }))
  await userEvent.click(screen.getByRole('button', { name: 'leave' }))
  await waitFor(() => expect(calls).toEqual(['put {"value":"name"}', 'logout']))
})
