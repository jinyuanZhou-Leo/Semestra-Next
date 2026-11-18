import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import type { UserOut } from '@semestra/api-client'
import { API, apiError, renderWithRouter, server, user } from '@/test-utils'
import { ResetPasswordFlow } from './ResetPasswordFlow'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

test('a weak new password is fixed in place, without a new code', async () => {
  const onSignedIn = vi.fn<(user: UserOut) => void>()
  const verified = vi.fn<(body: unknown) => void>()
  server.use(
    http.post(`${API}/auth/email/start`, () =>
      HttpResponse.json({ resend_in_seconds: 60, expires_in_seconds: 600 }),
    ),
    http.post(`${API}/auth/password/reset/verify`, async ({ request }) => {
      verified(await request.json())
      return HttpResponse.json({ reset_token: 'srst_abc', expires_in_seconds: 900 })
    }),
    http.post(`${API}/auth/password/reset`, async ({ request }) => {
      const body = (await request.json()) as { reset_token: string; new_password: string }
      expect(body.reset_token).toBe('srst_abc')
      if (body.new_password === 'password') {
        const e = apiError('auth.weak_password', 422, { reasons: ['too_common'], min_length: 8 })
        return HttpResponse.json(e.body, { status: e.status })
      }
      return HttpResponse.json({ status: 'signed_in', user })
    }),
  )
  renderWithRouter(<ResetPasswordFlow initialEmail="ada@example.com" onSignedIn={onSignedIn} />)

  await userEvent.click(await screen.findByRole('button', { name: 'Send code' }))
  await screen.findByText('Enter the code sent to ada@example.com.')
  await userEvent.keyboard('123456') // the OTP field has focus; the 6th digit checks it
  const password = await screen.findByLabelText('New password')
  await userEvent.type(password, 'password')
  await userEvent.click(screen.getByRole('button', { name: 'Reset password and sign in' }))
  expect(
    await screen.findByText('This password is too common. Choose another.'),
  ).toBeInTheDocument()

  await userEvent.clear(password)
  await userEvent.type(password, 'brand new pass 42')
  await userEvent.click(screen.getByRole('button', { name: 'Reset password and sign in' }))
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(user))
  expect(verified).toHaveBeenCalledTimes(1)
})
