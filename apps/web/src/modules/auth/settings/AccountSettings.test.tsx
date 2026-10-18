import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { ModuleRegistry } from '@/app/registry'
import { SettingsSections } from '@/app/settings'
import { API, renderWithRouter, server, user } from '@/test-utils'
import manifest from '../manifest'
import { AuthContext } from '../useAuth'
import { mcpConfig } from './TokensSection'

beforeAll(() => server.listen())
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

function mount(signOut: () => Promise<void> = async () => {}) {
  server.use(http.get(`${API}/auth/config`, () => HttpResponse.json({ google_client_id: null })))
  return renderWithRouter(
    <AuthContext.Provider value={{ user, isLoading: false, signOut }}>
      <ModuleRegistry value={[manifest]}>
        <SettingsSections level="account" group="account" />
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

  await userEvent.click(await screen.findByRole('button', { name: /Sign out of Chrome · macOS/ }))
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
  const buttons = await screen.findAllByRole('button', { name: /Sign out of Chrome · macOS/ })
  expect(buttons).toHaveLength(2)

  await userEvent.click(buttons[1]!)
  const dialog = await screen.findByRole('alertdialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }))

  await waitFor(() => expect(revoked).toHaveBeenCalledWith('s2'))
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: /Sign out of Chrome/ })).toHaveLength(1),
  )
})

test('creating a token reveals the plaintext once, with copy and MCP config', async () => {
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
  mount()

  await userEvent.click(await screen.findByRole('button', { name: 'Create token' }))
  const form = await screen.findByRole('dialog')
  await userEvent.type(within(form).getByLabelText('Name'), 'Claude Desktop')
  await userEvent.click(within(form).getByRole('combobox', { name: 'Access' }))
  await userEvent.click(await screen.findByRole('option', { name: 'Read and write' }))
  await userEvent.click(within(form).getByRole('combobox', { name: 'Expires' }))
  await userEvent.click(await screen.findByRole('option', { name: /90/ }))
  await userEvent.click(within(form).getByRole('button', { name: 'Create token' }))

  expect(await screen.findByTestId('new-token')).toHaveTextContent('spat_SECRET')
  expect(screen.getByRole('button', { name: 'Copy MCP config' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))

  await waitFor(() => expect(screen.queryByTestId('new-token')).not.toBeInTheDocument())
  expect(await screen.findByText('Claude Desktop')).toBeInTheDocument()
  expect(screen.queryByText('spat_SECRET')).not.toBeInTheDocument() // only the prefix is listed
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
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Revoke token Claude Desktop' }))
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

test('mcpConfig points Claude Desktop at the API and passes the token via env', () => {
  const parsed = JSON.parse(mcpConfig('spat_x', 'https://api.example.com/'))
  const server = parsed.mcpServers.semestra
  expect(server.args).toContain('https://api.example.com/mcp')
  expect(server.env.SEMESTRA_TOKEN).toBe('spat_x')
  expect(JSON.stringify(server.args)).not.toContain('spat_x')
})
