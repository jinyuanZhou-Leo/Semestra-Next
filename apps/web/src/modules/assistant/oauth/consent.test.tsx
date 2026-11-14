import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { LocaleProvider } from '@/app/locale'
import { AuthContext } from '@/modules/auth/useAuth'
import { API, apiError, renderWithRouter, server, user } from '@/test-utils'
import { ConsentPage } from './ConsentPage'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  window.location.hash = ''
})
afterAll(() => server.close())

// Back to the app: a change of hash is the one navigation jsdom performs.
const back = (answer: string) => `${window.location.href.split('#')[0]}#${answer}`

type Request = { scopes: string[]; local?: boolean; unverified?: boolean }

const details = (request: Request) =>
  request.local
    ? { client_name: 'Desk AI', app: null, host: 'localhost', local: true, scopes: request.scopes }
    : request.unverified
      ? {
          client_name: 'ChatGPT',
          app: null,
          host: 'evil.example',
          local: false,
          scopes: request.scopes,
        }
      : {
          client_name: 'ChatGPT',
          app: 'chatgpt',
          host: 'chatgpt.com',
          local: false,
          scopes: request.scopes,
        }

function mount(request: Request | 'expired' | 'down') {
  server.use(
    http.get(`${API}/account/authorizations/request`, () =>
      request === 'expired'
        ? HttpResponse.json(apiError('auth.authorization_expired', 400).body, { status: 400 })
        : request === 'down'
          ? HttpResponse.json(apiError('common.internal', 500).body, { status: 500 })
          : HttpResponse.json(details(request)),
    ),
    http.get(`${API}/account/reauth`, () => HttpResponse.json({ remaining_seconds: 600 })),
    http.get(`${API}/auth/config`, () => HttpResponse.json({ google_client_id: null })),
  )
  return renderWithRouter(
    <LocaleProvider>
      <AuthContext.Provider value={{ user, isLoading: false, signOut: async () => {} }}>
        <ConsentPage request="req" />
      </AuthContext.Provider>
    </LocaleProvider>,
  )
}

test('allowing sends the chosen access and returns to the app', async () => {
  let body: unknown
  server.use(
    http.post(`${API}/account/authorizations/approve`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ redirect_url: back('code') })
    }),
  )
  mount({ scopes: ['read', 'write'] })

  expect(
    await screen.findByRole('heading', { name: 'Allow ChatGPT to access your account?' }),
  ).toBeInTheDocument()
  expect(screen.getByText('ada@example.com')).toBeInTheDocument()
  expect(screen.getByText(/You'll return to chatgpt\.com/)).toBeInTheDocument()
  // Read only unless the user picks more.
  expect(screen.getByRole('radio', { name: /Read only/ })).toBeChecked()
  await userEvent.click(screen.getByRole('radio', { name: /Read and write/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Allow' }))

  await waitFor(() => expect(window.location.hash).toBe('#code'))
  expect(body).toEqual({ request: 'req', scopes: ['read', 'write'] })
})

test('an app that asked to read only gets no choice to write', async () => {
  mount({ scopes: ['read'], local: true })
  expect(await screen.findByRole('radio', { name: /Read only/ })).toBeChecked()
  expect(screen.queryByRole('radio', { name: /Read and write/ })).not.toBeInTheDocument()
  expect(
    screen.getByRole('heading', { name: 'Allow Desk AI to access your account?' }),
  ).toBeInTheDocument()
  expect(screen.getByText(/runs on your computer/)).toBeInTheDocument()
})

test('an app the server cannot verify is named by its site, with its claim beneath', async () => {
  mount({ scopes: ['read'], unverified: true })
  expect(
    await screen.findByRole('heading', { name: 'Allow evil.example to access your account?' }),
  ).toBeInTheDocument()
  expect(screen.getByText(/calls itself “ChatGPT”/)).toBeInTheDocument()
})

test('a request that fails to load can be retried', async () => {
  mount('down')
  const retry = await screen.findByRole('button', { name: 'Retry' })
  server.use(
    http.get(`${API}/account/authorizations/request`, () =>
      HttpResponse.json(details({ scopes: ['read'] })),
    ),
  )
  await userEvent.click(retry)
  expect(
    await screen.findByRole('heading', { name: 'Allow ChatGPT to access your account?' }),
  ).toBeInTheDocument()
})

test('denying returns to the app', async () => {
  server.use(
    http.post(`${API}/account/authorizations/deny`, () =>
      HttpResponse.json({ redirect_url: back('denied') }),
    ),
  )
  mount({ scopes: ['read', 'write'] })
  await userEvent.click(await screen.findByRole('button', { name: 'Deny' }))
  await waitFor(() => expect(window.location.hash).toBe('#denied'))
})

test('an expired request says to start over from the app', async () => {
  mount('expired')
  expect(await screen.findByText('This request has expired')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
})
