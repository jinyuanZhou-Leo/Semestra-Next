import { accountSessionsList } from '@semestra/api-client'
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { isReauthPending, setSignedIn, settleReauth } from '@/app/session-expiry'
import { API, apiError, renderWithQuery, server, user } from '@/test-utils'
import { SessionExpiredDialog } from './components/SessionExpiredDialog'
import { AuthContext } from './useAuth'

beforeAll(() => server.listen())
afterEach(() => {
  server.resetHandlers()
  setSignedIn(false)
  if (isReauthPending()) settleReauth(false)
})
afterAll(() => server.close())

function unauthorized() {
  const e = apiError('common.unauthenticated', 401)
  return HttpResponse.json(e.body, { status: e.status })
}

test('a 401 while signed in waits for re-login, then the request is retried', async () => {
  let calls = 0
  server.use(
    http.get(`${API}/account/sessions`, () => {
      calls += 1
      return calls === 1 ? unauthorized() : HttpResponse.json({ items: [] })
    }),
  )
  setSignedIn(true)

  const result = accountSessionsList({ throwOnError: true })
  await waitFor(() => expect(isReauthPending()).toBe(true))
  act(() => settleReauth(true))

  const { data } = await result
  expect(data).toEqual({ items: [] })
  expect(calls).toBe(2)
})

test('giving up surfaces the original 401', async () => {
  server.use(http.get(`${API}/account/sessions`, () => unauthorized()))
  setSignedIn(true)

  const result = accountSessionsList({ throwOnError: true }).catch((e: unknown) => e)
  await waitFor(() => expect(isReauthPending()).toBe(true))
  act(() => settleReauth(false))

  const error = (await result) as { status: number; code: string }
  expect(error.status).toBe(401)
  expect(error.code).toBe('common.unauthenticated')
})

test('a 401 when nobody was signed in is just an error (no dialog)', async () => {
  server.use(http.get(`${API}/account/sessions`, () => unauthorized()))
  await expect(accountSessionsList({ throwOnError: true })).rejects.toMatchObject({ status: 401 })
  expect(isReauthPending()).toBe(false)
})

test('writes carry the CSRF header from the cookie', async () => {
  document.cookie = 'semestra_csrf=tok123; path=/'
  let header: string | null = null
  server.use(
    http.post(`${API}/auth/logout`, ({ request }) => {
      header = request.headers.get('x-semestra-csrf')
      return HttpResponse.json({ ok: true })
    }),
  )
  const { authLogout } = await import('@semestra/api-client')
  await authLogout()
  expect(header).toBe('tok123')
})

test('the dialog shows over the page and offers sign-in with the same email', async () => {
  server.use(http.get(`${API}/auth/config`, () => HttpResponse.json({ google_client_id: null })))
  setSignedIn(true)
  renderWithQuery(
    <AuthContext.Provider value={{ user, isLoading: false, signOut: async () => {} }}>
      <p>unsaved page</p>
      <SessionExpiredDialog />
    </AuthContext.Provider>,
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  const { accountSessionsList: call } = await import('@semestra/api-client')
  server.use(http.get(`${API}/account/sessions`, () => unauthorized()))
  const pending = call({ throwOnError: true }).catch(() => null)

  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(screen.getByText('Your session expired')).toBeInTheDocument()
  expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com')
  expect(screen.getByText('unsaved page')).toBeInTheDocument()
  act(() => settleReauth(false))
  await pending
})
