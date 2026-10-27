import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { routeTree } from '@/routeTree.gen'
import { academicsHandlers, defaultWorld } from '@/modules/academics/test-data'
import { API, apiError, newQueryClient, server, user } from '@/test-utils'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
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
  // Every request of the page answers 401, as the server does for a signed-out visitor.
  const e = apiError('common.unauthenticated', 401)
  const anything = http.all(`${API}/*`, () => HttpResponse.json(e.body, { status: 401 }))
  server.use(noGoogle, healthy, anything)
  const router = mount('/p/p1/grades?view=plan')

  expect(await screen.findByRole('heading', { name: 'Welcome to Semestra' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/login')
  expect(router.state.location.search).toEqual({ redirect: '/p/p1/grades?view=plan' })
})

/** A new account: no Programs yet, so `/` leads to onboarding; no plugins in the catalog. */
const noPrograms = () => [
  ...academicsHandlers({ ...defaultWorld(), programs: [] }),
  http.get(`${API}/plugins/catalog`, () => HttpResponse.json({ items: [] })),
]

test('signed-in users reach the protected page', async () => {
  server.use(signedIn, healthy, noGoogle, ...noPrograms())
  const router = mount('/')
  expect(await screen.findByTestId('signed-in-as')).toHaveTextContent('Signed in as Ada')
  expect(router.state.location.pathname).toBe('/onboarding')
})

test('visiting /login while signed in goes straight to the redirect target', async () => {
  server.use(signedIn, healthy, noGoogle, ...noPrograms())
  const router = mount('/login?redirect=%2Fonboarding%3Fsettings%3Daccount')
  await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding'))
  expect(router.state.location.search).toEqual({ settings: 'account' })
})

test('an off-site redirect target is ignored', async () => {
  server.use(signedIn, healthy, noGoogle, ...noPrograms())
  const router = mount('/login?redirect=https%3A%2F%2Fevil.example')
  await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding'))
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
    ...noPrograms(),
    ...settingsData,
    http.post(`${API}/auth/logout`, () => {
      loggedOut = true
      return HttpResponse.json({ ok: true })
    }),
  )
  const router = mount('/onboarding?settings=account/account')
  await confirmSignOut()
  await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
})

async function confirmSignOut() {
  await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
  const dialog = await screen.findByRole('alertdialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }))
  return dialog
}

test('a failed logout keeps the user on the page instead of pretending to sign out', async () => {
  server.use(
    signedIn,
    healthy,
    noGoogle,
    ...noPrograms(),
    ...settingsData,
    http.post(`${API}/auth/logout`, () => HttpResponse.error()),
  )
  const router = mount('/onboarding?settings=account/account')
  const dialog = await confirmSignOut()
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { name: 'Sign out' })).toBeEnabled(),
  )
  expect(router.state.location.pathname).toBe('/onboarding')
})
