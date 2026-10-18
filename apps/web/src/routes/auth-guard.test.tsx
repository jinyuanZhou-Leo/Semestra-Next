import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { routeTree } from '@/routeTree.gen'
import { API, apiError, newQueryClient, server, user } from '@/test-utils'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function mount(path: string) {
  const queryClient = newQueryClient()
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const noGoogle = http.get(`${API}/auth/config`, () => HttpResponse.json({ google_client_id: null }))
const healthy = http.get(`${API}/healthz`, () => HttpResponse.json({ status: 'ok' }))

function signedOut() {
  const e = apiError('common.unauthenticated', 401)
  return http.get(`${API}/account/me`, () => HttpResponse.json(e.body, { status: 401 }))
}
const signedIn = http.get(`${API}/account/me`, () => HttpResponse.json(user))

test('signed-out visitors to a protected page are sent to /login?redirect=…', async () => {
  server.use(signedOut(), noGoogle, healthy)
  const router = mount('/settings/account?tab=tokens')

  expect(await screen.findByRole('heading', { name: 'Welcome to Semestra' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/login')
  expect(router.state.location.search).toEqual({ redirect: '/settings/account?tab=tokens' })
})

test('signed-in users reach the protected page', async () => {
  server.use(signedIn, healthy, noGoogle)
  mount('/')
  expect(await screen.findByTestId('signed-in-as')).toHaveTextContent('Signed in as Ada')
})

test('visiting /login while signed in goes straight to the redirect target', async () => {
  server.use(signedIn, healthy, noGoogle)
  const router = mount('/login?redirect=%2Fsettings%2Faccount')
  await waitFor(() => expect(router.state.location.pathname).toBe('/settings/account'))
})

test('an off-site redirect target is ignored', async () => {
  server.use(signedIn, healthy, noGoogle)
  const router = mount('/login?redirect=https%3A%2F%2Fevil.example')
  await waitFor(() => expect(router.state.location.pathname).toBe('/'))
})

test('/login/reset renders the reset form, not the sign-in form', async () => {
  server.use(signedOut(), noGoogle, healthy)
  mount('/login/reset')
  expect(await screen.findByRole('heading', { name: 'Reset your password' })).toBeInTheDocument()
})

const settingsData = [
  http.get(`${API}/account/sessions`, () => HttpResponse.json({ items: [] })),
  http.get(`${API}/account/tokens`, () => HttpResponse.json({ items: [] })),
]

test('signing out navigates to /login once the server has cleared the session', async () => {
  let loggedOut = false
  const e = apiError('common.unauthenticated', 401)
  server.use(
    http.get(`${API}/account/me`, () =>
      loggedOut ? HttpResponse.json(e.body, { status: 401 }) : HttpResponse.json(user),
    ),
    healthy,
    noGoogle,
    ...settingsData,
    http.post(`${API}/auth/logout`, () => {
      loggedOut = true
      return HttpResponse.json({ ok: true })
    }),
  )
  const router = mount('/settings/account')
  await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
})

test('a failed logout keeps the user on the page instead of pretending to sign out', async () => {
  server.use(
    signedIn,
    healthy,
    noGoogle,
    ...settingsData,
    http.post(`${API}/auth/logout`, () => HttpResponse.error()),
  )
  const router = mount('/settings/account')
  await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled())
  expect(router.state.location.pathname).toBe('/settings/account')
})
