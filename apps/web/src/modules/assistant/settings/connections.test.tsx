import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { AuthContext } from '@/modules/auth/useAuth'
import { API, apiError, renderWithRouter, server, user } from '@/test-utils'
import { ConnectionsSection } from './ConnectionsSection'
import { mcpSetup } from './mcp-clients'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const url = 'https://semestra.example/mcp'

const token = {
  id: 't1',
  name: 'Claude Code',
  prefix: 'spat_AbC',
  scopes: ['read'],
  created_at: '2026-11-08T00:00:00Z',
  last_used_at: null,
  expires_at: null,
}

function mount() {
  server.use(http.get(`${API}/auth/config`, () => HttpResponse.json({ google_client_id: null })))
  return renderWithRouter(
    <AuthContext.Provider value={{ user, isLoading: false, signOut: async () => {} }}>
      <ConnectionsSection />
    </AuthContext.Provider>,
  )
}

test('install links carry the server config with the token, without going over the network', () => {
  const setup = mcpSetup('cursor', url, 'spat_x')
  if (setup.kind !== 'link') throw new Error(setup.kind)
  const config = new URL(setup.href).searchParams.get('config')!
  expect(JSON.parse(atob(config))).toEqual({ url, headers: { Authorization: 'Bearer spat_x' } })
  expect(JSON.parse(setup.text).mcpServers.semestra.url).toBe(url)
  for (const id of ['cursor', 'lm-studio'] as const) {
    const link = mcpSetup(id, url, 'spat_x')
    expect(link.kind === 'link' && new URL(link.href).protocol).not.toBe('https:')
  }
})

test('connecting a client creates a token named after it and fills it into the command', async () => {
  const items: (typeof token)[] = []
  server.use(
    http.get(`${API}/account/tokens`, () => HttpResponse.json({ items })),
    http.post(`${API}/account/tokens`, async ({ request }) => {
      expect(await request.json()).toEqual({
        name: 'Claude Code',
        scopes: ['read', 'write'],
        expires_in_days: null,
      })
      items.push(token)
      return HttpResponse.json({ ...token, scopes: ['read', 'write'], token: 'spat_SECRET' })
    }),
  )
  mount()

  await userEvent.click(await screen.findByRole('button', { name: 'New connection' }))
  const dialog = await screen.findByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Claude Code' }))
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Access' }))
  await userEvent.click(await screen.findByRole('option', { name: /Read and write/ }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create API token' }))

  expect(await screen.findByText(/claude mcp add --transport http semestra/)).toHaveTextContent(
    'Authorization: Bearer spat_SECRET',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(screen.queryByText(/spat_SECRET/)).not.toBeInTheDocument())
  expect(await screen.findByText('Claude Code')).toBeInTheDocument() // listed by its prefix only
})

test('a token for anything else takes a name, and confirming who you are sends it again', async () => {
  let verified = false
  server.use(
    http.get(`${API}/account/tokens`, () => HttpResponse.json({ items: [] })),
    http.post(`${API}/account/reauth/password`, async ({ request }) => {
      verified = ((await request.json()) as { password: string }).password === 'hunter22hunter22'
      return verified
        ? HttpResponse.json({ ok: true })
        : HttpResponse.json(apiError('auth.wrong_password', 400).body, { status: 400 })
    }),
    http.post(`${API}/account/tokens`, async ({ request }) => {
      expect(((await request.json()) as { name: string }).name).toBe('CLI')
      return verified
        ? HttpResponse.json({ ...token, name: 'CLI', token: 'spat_SECRET' })
        : HttpResponse.json(apiError('auth.reauth_required', 403).body, { status: 403 })
    }),
  )
  mount()

  await userEvent.click(await screen.findByRole('button', { name: 'New connection' }))
  const dialog = await screen.findByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Other client or script' }))
  const create = within(dialog).getByRole('button', { name: 'Create API token' })
  expect(create).toBeDisabled()
  await userEvent.type(within(dialog).getByLabelText('Name'), 'CLI')
  await userEvent.click(create)
  const password = await within(dialog).findByLabelText('Password')
  expect(create).toBeDisabled()
  await userEvent.type(password, 'wrong{Enter}')
  expect(await within(dialog).findByText('Incorrect password.')).toBeInTheDocument()
  await userEvent.clear(password)
  await userEvent.type(password, 'hunter22hunter22')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))

  // Confirming sends the creation again on its own; the token is shown with the address.
  expect(await screen.findByText('spat_SECRET')).toBeInTheDocument()
})

test('revoking a connection asks for confirmation first', async () => {
  const revoked = vi.fn<(id: string) => void>()
  server.use(
    http.get(`${API}/account/tokens`, () => HttpResponse.json({ items: [token] })),
    http.delete(`${API}/account/tokens/:id`, ({ params }) => {
      revoked(String(params.id))
      return HttpResponse.json({ ok: true })
    }),
  )
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Actions for Claude Code' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Revoke' }))
  expect(revoked).not.toHaveBeenCalled()
  const dialog = await screen.findByRole('alertdialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }))
  await waitFor(() => expect(revoked).toHaveBeenCalledWith('t1'))
})
