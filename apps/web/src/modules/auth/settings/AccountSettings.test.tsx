import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { ModuleRegistry } from '@/app/registry'
import { SettingsSections } from '@/app/settings'
import { API, apiError, renderWithRouter, server, user } from '@/test-utils'
import manifest from '../manifest'
import { AuthContext } from '../useAuth'
import { SignInMethodsSection } from './SignInMethodsSection'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const session = (over: Record<string, unknown>) => ({
  id: 's1',
  kind: 'web',
  user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36',
  ip: '1.2.3.4',
  created_at: '2026-01-01T00:00:00Z',
  last_used_at: '2026-01-02T10:00:00Z',
  expires_at: '2026-02-01T00:00:00Z',
  current: false,
  ...over,
})

const token = {
  id: 't1',
  name: 'Claude Desktop',
  prefix: 'spat_AbC',
  scopes: ['read'],
  created_at: '2026-01-01T00:00:00Z',
  last_used_at: null,
  expires_at: null,
}

function mount(
  signOut: () => Promise<void> = async () => {},
  group: 'account' | 'api-mcp' = 'account',
) {
  server.use(
    http.get(`${API}/auth/config`, () => HttpResponse.json({ google_client_id: null })),
    http.get(`${API}/account/reauth`, () => HttpResponse.json({ remaining_seconds: 600 })),
  )
  return renderWithRouter(
    <AuthContext.Provider value={{ user, isLoading: false, signOut }}>
      <ModuleRegistry value={[manifest]}>
        <SettingsSections level="account" group={group} />
      </ModuleRegistry>
    </AuthContext.Provider>,
  )
}

test('signing out the current device goes through the normal sign-out flow', async () => {
  const revoked = vi.fn<(id: string) => void>()
  const signOut = vi.fn<() => Promise<void>>(async () => {})
  server.use(
    http.get(`${API}/account/tokens`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/account/sessions`, () =>
      HttpResponse.json({ items: [session({ id: 's1', current: true })] }),
    ),
    http.delete(`${API}/account/sessions/:id`, ({ params }) => {
      revoked(String(params.id))
      return HttpResponse.json({ ok: true })
    }),
  )
  mount(signOut)

  await userEvent.click(await screen.findByRole('button', { name: /Actions for Chrome · macOS/ }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
  const dialog = await screen.findByRole('alertdialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }))
  expect(signOut).toHaveBeenCalledTimes(1)
  expect(revoked).not.toHaveBeenCalled()
})

test('lists devices and signs one out after confirmation', async () => {
  let sessions = [session({ id: 's1', current: true }), session({ id: 's2', kind: 'native' })]
  const revoked = vi.fn<(id: string) => void>()
  server.use(
    http.get(`${API}/account/tokens`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/account/sessions`, () => HttpResponse.json({ items: sessions })),
    http.delete(`${API}/account/sessions/:id`, ({ params }) => {
      revoked(String(params.id))
      sessions = sessions.filter((s) => s.id !== params.id)
      return HttpResponse.json({ ok: true })
    }),
  )
  mount()

  expect(await screen.findByText('This device')).toBeInTheDocument()
  const buttons = await screen.findAllByRole('button', { name: /Actions for Chrome · macOS/ })
  expect(buttons).toHaveLength(2)

  await userEvent.click(buttons[1]!)
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
  const dialog = await screen.findByRole('alertdialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }))

  await waitFor(() => expect(revoked).toHaveBeenCalledWith('s2'))
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: /Actions for Chrome/ })).toHaveLength(1),
  )
})

test('creating a token reveals the plaintext once', async () => {
  const items: (typeof token)[] = []
  server.use(
    http.get(`${API}/account/sessions`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/account/tokens`, () => HttpResponse.json({ items })),
    http.post(`${API}/account/tokens`, async ({ request }) => {
      expect(await request.json()).toEqual({
        name: 'Claude Desktop',
        scopes: ['read', 'write'],
        expires_in_days: 90,
      })
      items.push(token)
      return HttpResponse.json({ ...token, scopes: ['read', 'write'], token: 'spat_SECRET' })
    }),
  )
  mount(undefined, 'api-mcp')

  await userEvent.click(await screen.findByRole('button', { name: 'Create API token' }))
  const form = await screen.findByRole('dialog')
  await userEvent.type(within(form).getByLabelText('Name'), 'Claude Desktop')
  await userEvent.click(within(form).getByRole('button', { name: 'Read and write' }))
  await userEvent.click(within(form).getByRole('button', { name: /90/ }))
  await userEvent.click(within(form).getByRole('button', { name: 'Create API token' }))

  expect(await screen.findByTestId('new-token')).toHaveTextContent('spat_SECRET')
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))

  await waitFor(() => expect(screen.queryByTestId('new-token')).not.toBeInTheDocument())
  expect(await screen.findByText('Claude Desktop')).toBeInTheDocument()
  expect(screen.queryByText('spat_SECRET')).not.toBeInTheDocument() // only the prefix is listed
})

test('after the re-authentication window, the dialog confirms it is the user before the form', async () => {
  const verified = { remaining_seconds: 600 }
  server.use(
    http.get(`${API}/account/sessions`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/account/tokens`, () => HttpResponse.json({ items: [] })),
    http.post(`${API}/account/reauth/password`, async ({ request }) =>
      ((await request.json()) as { password: string }).password === 'hunter22hunter22'
        ? HttpResponse.json(verified)
        : HttpResponse.json(apiError('auth.wrong_password', 400).body, { status: 400 }),
    ),
    http.post(`${API}/account/tokens`, () => HttpResponse.json({ ...token, token: 'spat_SECRET' })),
  )
  mount(undefined, 'api-mcp')
  server.use(http.get(`${API}/account/reauth`, () => HttpResponse.json({ remaining_seconds: 0 })))

  await userEvent.click(await screen.findByRole('button', { name: 'Create API token' }))
  const form = await screen.findByRole('dialog')
  // The confirmation takes the fields' place; the form cannot be sent yet.
  const password = await within(form).findByLabelText('Password')
  expect(within(form).queryByRole('textbox', { name: 'Name' })).toBeNull()
  expect(within(form).getByRole('button', { name: 'Create API token' })).toBeDisabled()
  await userEvent.type(password, 'wrong{Enter}')
  expect(await within(form).findByText('Incorrect password.')).toBeInTheDocument()
  await userEvent.clear(password)
  await userEvent.type(password, 'hunter22hunter22')
  await userEvent.click(within(form).getByRole('button', { name: 'Confirm' }))

  await userEvent.type(await within(form).findByRole('textbox', { name: 'Name' }), 'CLI')
  await userEvent.click(within(form).getByRole('button', { name: 'Create API token' }))
  expect(await screen.findByTestId('new-token')).toHaveTextContent('spat_SECRET')
})

test('an action refused for an old sign-in is sent again after an emailed code', async () => {
  let verified = false
  const codes: unknown[] = []
  server.use(
    http.get(`${API}/account/sessions`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/account/tokens`, () => HttpResponse.json({ items: [] })),
    http.post(`${API}/account/reauth/email-start`, () =>
      HttpResponse.json({ resend_in_seconds: 60, expires_in_seconds: 600 }),
    ),
    http.post(`${API}/account/reauth/email-verify`, async ({ request }) => {
      codes.push(await request.json())
      verified = true
      return HttpResponse.json({ remaining_seconds: 600 })
    }),
    http.post(`${API}/account/email/change-start`, () =>
      verified
        ? HttpResponse.json({ resend_in_seconds: 60, expires_in_seconds: 600 })
        : HttpResponse.json(apiError('auth.reauth_required', 403).body, { status: 403 }),
    ),
  )
  mount()

  await userEvent.click(await screen.findByRole('button', { name: 'Change email' }))
  await userEvent.type(screen.getByLabelText('New email'), 'new@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Send code' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Use an email code instead' }))
  await userEvent.click(screen.getByRole('button', { name: 'Send code' }))
  await userEvent.type(await screen.findByLabelText('Verification code'), '123456')

  expect(await screen.findByText(/new@example\.com/)).toBeInTheDocument()
  expect(codes).toEqual([{ code: '123456' }])
})

test('revoking a token asks for confirmation first', async () => {
  const revoked = vi.fn<(id: string) => void>()
  server.use(
    http.get(`${API}/account/sessions`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/account/tokens`, () => HttpResponse.json({ items: [token] })),
    http.delete(`${API}/account/tokens/:id`, ({ params }) => {
      revoked(String(params.id))
      return HttpResponse.json({ ok: true })
    }),
  )
  mount(undefined, 'api-mcp')
  await userEvent.click(await screen.findByRole('button', { name: 'Actions for Claude Desktop' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Revoke' }))
  expect(revoked).not.toHaveBeenCalled()
  const dialog = await screen.findByRole('alertdialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }))
  await waitFor(() => expect(revoked).toHaveBeenCalledWith('t1'))
})

test('setting a name saves the profile', async () => {
  const saved = vi.fn<(body: unknown) => void>()
  server.use(
    http.get(`${API}/account/sessions`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/account/tokens`, () => HttpResponse.json({ items: [] })),
    http.patch(`${API}/account/profile`, async ({ request }) => {
      const body = await request.json()
      saved(body)
      return HttpResponse.json({ ...user, display_name: 'Ada L.' })
    }),
  )
  mount()
  const name = await screen.findByLabelText('Name')
  await userEvent.clear(name)
  await userEvent.type(name, 'Ada L.')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(saved).toHaveBeenCalledWith({ display_name: 'Ada L.' }))
})

const googleIdentity = {
  provider: 'google' as const,
  email: 'ada@gmail.com',
  created_at: '2026-01-01T00:00:00Z',
}

test('the official Google button sits on the Google row; its credential links the account', async () => {
  const linked = vi.fn<(body: unknown) => void>()
  let onCredential: ((response: { credential: string }) => void) | undefined
  const renderButton = vi.fn<(parent: HTMLElement) => void>((parent) => {
    parent.append(Object.assign(document.createElement('button'), { textContent: 'Google' }))
  })
  window.google = {
    accounts: {
      id: {
        initialize: (config) => {
          onCredential = config.callback
        },
        renderButton,
      },
    },
  }
  server.use(
    http.get(`${API}/auth/config`, () => HttpResponse.json({ google_client_id: 'cid' })),
    http.get(`${API}/account/reauth`, () => HttpResponse.json({ remaining_seconds: 600 })),
    http.post(`${API}/account/google/link`, async ({ request }) => {
      linked(await request.json())
      return HttpResponse.json({
        ...user,
        identities: [googleIdentity],
      })
    }),
  )
  renderWithRouter(<SignInMethodsSection user={user} />)

  await waitFor(() => expect(renderButton).toHaveBeenCalled())
  const [parent, options] = renderButton.mock.calls[0] as unknown as [HTMLElement, object]
  expect(options).toMatchObject({ size: 'medium', shape: 'pill' })
  // On the right of the row, like "Change email", not a full-width button under it.
  const row = parent.closest('[data-slot="item"]') as HTMLElement
  expect(within(row).getByText('Not linked')).toBeInTheDocument()
  onCredential?.({ credential: 'id-token' })
  await waitFor(() => expect(linked).toHaveBeenCalledWith({ id_token: 'id-token' }))
  delete window.google
})

test('a linked Google account shows its email and unlinks after confirmation', async () => {
  const unlinked = vi.fn<() => void>()
  server.use(
    http.get(`${API}/auth/config`, () => HttpResponse.json({ google_client_id: 'cid' })),
    http.get(`${API}/account/reauth`, () => HttpResponse.json({ remaining_seconds: 600 })),
    http.post(`${API}/account/google/unlink`, () => {
      unlinked()
      return HttpResponse.json(user)
    }),
  )
  renderWithRouter(<SignInMethodsSection user={{ ...user, identities: [googleIdentity] }} />)
  expect(await screen.findByText('Linked as ada@gmail.com')).toBeInTheDocument()
  expect(screen.queryByTestId('google-button')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Unlink' }))
  const confirm = await screen.findByRole('alertdialog')
  await userEvent.click(within(confirm).getByRole('button', { name: 'Unlink' }))
  await waitFor(() => expect(unlinked).toHaveBeenCalled())
})
