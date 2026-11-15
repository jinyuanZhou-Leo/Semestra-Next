import { accountEmailChangeStartMutation } from '@semestra/api-client/react-query'
import { useMutation } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { API, apiError, renderWithRouter, server, user } from '@/test-utils'
import { AuthContext } from '../useAuth'
import { ReauthGate } from './ReauthGate'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function Action() {
  const action = useMutation(accountEmailChangeStartMutation())
  const send = () => action.mutate({ body: { new_email: 'new@example.com' } })
  return (
    <ReauthGate error={action.error} onVerified={send}>
      <button type="button" onClick={send}>
        Act
      </button>
    </ReauthGate>
  )
}

test('confirming again starts afresh, without the last password', async () => {
  let needed = true
  server.use(
    http.get(`${API}/auth/config`, () => HttpResponse.json({ google_client_id: null })),
    http.get(`${API}/account/reauth`, () => HttpResponse.json({ remaining_seconds: 600 })),
    http.post(`${API}/account/reauth/password`, () => {
      needed = false
      return HttpResponse.json({ remaining_seconds: 600 })
    }),
    http.post(`${API}/account/email/change-start`, () =>
      needed
        ? HttpResponse.json(apiError('auth.reauth_required', 403).body, { status: 403 })
        : HttpResponse.json({ resend_in_seconds: 60, expires_in_seconds: 600 }),
    ),
  )
  renderWithRouter(
    <AuthContext.Provider value={{ user, isLoading: false, signOut: async () => {} }}>
      <Action />
    </AuthContext.Provider>,
  )

  await userEvent.click(await screen.findByRole('button', { name: 'Act' }))
  await userEvent.type(await screen.findByLabelText('Password'), 'correct horse')
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Act' })).toBeVisible())

  needed = true // e.g. the page stayed open past the 10 minutes
  await userEvent.click(screen.getByRole('button', { name: 'Act' }))
  await waitFor(() => expect(screen.getByLabelText('Password')).toHaveValue(''))
})
