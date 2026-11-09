import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { AuthContext } from '@/modules/auth/useAuth'
import { API, renderWithRouter, server, user } from '@/test-utils'
import { ConnectClientDialog } from './ConnectClientDialog'
import { mcpSetup } from './mcp-clients'

const url = 'https://semestra.example/mcp'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

test('install links carry the server config with the token', () => {
  const setup = mcpSetup('cursor', url, 'spat_x')
  if (setup.kind !== 'link') throw new Error(setup.kind)
  const config = new URL(setup.href).searchParams.get('config')!
  expect(JSON.parse(atob(config))).toEqual({ url, headers: { Authorization: 'Bearer spat_x' } })
  expect(JSON.parse(setup.text).mcpServers.semestra.url).toBe(url)
  // No link sends the token over the network: each opens its app directly.
  for (const id of ['cursor', 'lm-studio'] as const) {
    const link = mcpSetup(id, url, 'spat_x')
    expect(link.kind === 'link' && new URL(link.href).protocol).not.toBe('https:')
  }
})

test('connecting a client creates a token named after it and fills it into the command', async () => {
  server.use(
    http.get(`${API}/account/reauth`, () => HttpResponse.json({ remaining_seconds: 600 })),
    http.post(`${API}/account/tokens`, async ({ request }) => {
      expect(await request.json()).toEqual({
        name: 'Claude Code',
        scopes: ['read', 'write'],
        expires_in_days: null,
      })
      return HttpResponse.json({
        id: 't1',
        name: 'Claude Code',
        prefix: 'spat_SECR',
        scopes: ['read', 'write'],
        created_at: '2026-11-08T00:00:00Z',
        last_used_at: null,
        expires_at: null,
        token: 'spat_SECRET',
      })
    }),
  )
  renderWithRouter(
    <AuthContext.Provider value={{ user, isLoading: false, signOut: async () => {} }}>
      <ConnectClientDialog open onOpenChange={() => {}} url={url} />
    </AuthContext.Provider>,
  )

  const dialog = await screen.findByRole('dialog')
  const create = within(dialog).getByRole('button', { name: 'Create token and continue' })
  expect(create).toBeDisabled()
  await userEvent.click(within(dialog).getByRole('radio', { name: /Claude Code/ }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Read and write' }))
  await userEvent.click(create)

  expect(await screen.findByRole('heading', { name: 'Connect Claude Code' })).toBeInTheDocument()
  expect(screen.getByText(/claude mcp add --transport http semestra/)).toHaveTextContent(
    'Authorization: Bearer spat_SECRET',
  )
})
