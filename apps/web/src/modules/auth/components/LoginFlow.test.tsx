import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import type { UserOut } from '@semestra/api-client'
import { API, apiError, renderWithRouter, server, user } from '@/test-utils'
import { LoginFlow } from './LoginFlow'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const config = http.get(`${API}/auth/config`, () => HttpResponse.json({ google_client_id: null }))
const started = http.post(`${API}/auth/email/start`, () =>
  HttpResponse.json({ resend_in_seconds: 60, expires_in_seconds: 600 }),
)

async function enterEmail(email: string) {
  const input = await screen.findByLabelText('Email')
  await userEvent.type(input, email)
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

test('existing account: email → code → signed in', async () => {
  const onSignedIn = vi.fn<(user: UserOut) => void>()
  server.use(
    config,
    started,
    http.post(`${API}/auth/email/verify`, async ({ request }) => {
      expect(await request.json()).toEqual({ email: 'ada@example.com', code: '123456' })
      return HttpResponse.json({ status: 'signed_in', user })
    }),
  )
  renderWithRouter(<LoginFlow onSignedIn={onSignedIn} />)

  await enterEmail('ada@example.com')
  expect(await screen.findByText(/A 6-digit code was sent to ada@example.com/)).toBeInTheDocument()
  await userEvent.keyboard('123456') // the OTP field has focus; typing submits on the 6th digit
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(user))
})

test('new account: email → code → profile → signed in', async () => {
  const onSignedIn = vi.fn<(user: UserOut) => void>()
  server.use(
    config,
    started,
    http.post(`${API}/auth/email/verify`, () =>
      HttpResponse.json({ status: 'needs_profile', registration_token: 'sreg_abc' }),
    ),
    http.post(`${API}/auth/register/complete`, async ({ request }) => {
      expect(await request.json()).toEqual({
        registration_token: 'sreg_abc',
        display_name: 'Ada',
        password: null,
      })
      return HttpResponse.json({ status: 'signed_in', user })
    }),
  )
  renderWithRouter(<LoginFlow onSignedIn={onSignedIn} />)

  await enterEmail('ada@example.com')
  await screen.findByText(/A 6-digit code was sent/)
  await userEvent.keyboard('654321')
  const name = await screen.findByLabelText('Name')
  await userEvent.type(name, 'Ada')
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(user))
})

test('a wrong code shows the translated error and clears the field', async () => {
  server.use(
    config,
    started,
    http.post(`${API}/auth/email/verify`, () => {
      const e = apiError('auth.invalid_code', 400)
      return HttpResponse.json(e.body, { status: e.status })
    }),
  )
  renderWithRouter(<LoginFlow onSignedIn={vi.fn<(user: UserOut) => void>()} />)
  await enterEmail('ada@example.com')
  await screen.findByText(/A 6-digit code was sent/)
  await userEvent.keyboard('111111')
  expect(await screen.findByRole('alert')).toHaveTextContent("That code isn't right")
})

test('rate limit errors interpolate the wait time', async () => {
  server.use(
    config,
    http.post(`${API}/auth/email/start`, () => {
      const e = apiError('common.rate_limited', 429, { retry_after_seconds: 42 })
      return HttpResponse.json(e.body, { status: e.status })
    }),
  )
  renderWithRouter(<LoginFlow onSignedIn={vi.fn<(user: UserOut) => void>()} />)
  await enterEmail('ada@example.com')
  expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 42 seconds')
})

test('invalid email is rejected locally without calling the API', async () => {
  server.use(config)
  renderWithRouter(<LoginFlow onSignedIn={vi.fn<(user: UserOut) => void>()} />)
  await enterEmail('nope')
  expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
})

test('password sign-in', async () => {
  const onSignedIn = vi.fn<(user: UserOut) => void>()
  server.use(
    config,
    http.post(`${API}/auth/password/login`, async ({ request }) => {
      expect(await request.json()).toEqual({ email: 'ada@example.com', password: 'hunter2hunter2' })
      return HttpResponse.json({ status: 'signed_in', user })
    }),
  )
  renderWithRouter(<LoginFlow onSignedIn={onSignedIn} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Sign in with a password' }))
  await userEvent.type(await screen.findByLabelText('Email'), 'ada@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'hunter2hunter2')
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(user))
})

test('failed password sign-in shows the credentials error', async () => {
  server.use(
    config,
    http.post(`${API}/auth/password/login`, () => {
      const e = apiError('auth.invalid_credentials', 401)
      return HttpResponse.json(e.body, { status: e.status })
    }),
  )
  renderWithRouter(<LoginFlow onSignedIn={vi.fn<(user: UserOut) => void>()} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Sign in with a password' }))
  await userEvent.type(await screen.findByLabelText('Email'), 'ada@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'wrong-wrong')
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password')
})

test('offers common email domains after the @ and Tab accepts the first', async () => {
  server.use(config)
  renderWithRouter(<LoginFlow onSignedIn={vi.fn<(user: UserOut) => void>()} />)
  const input = await screen.findByLabelText('Email')
  await userEvent.type(input, 'ann@gm')
  expect(screen.getByRole('button', { name: 'ann@gmail.com' })).toBeInTheDocument()
  await userEvent.tab()
  expect(input).toHaveValue('ann@gmail.com')
})
