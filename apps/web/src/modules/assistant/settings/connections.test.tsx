import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { AuthContext } from '@/modules/auth/useAuth'
import { API, apiError, renderWithRouter, server, user } from '@/test-utils'
import { SectionFrame } from '@/app/settings/SettingsSections'
import { AddConnectionDialog } from './AddConnectionDialog'
import { ConnectionsSection } from './ConnectionsSection'
import { mcpSetup } from './mcp-clients'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const url = 'https://semestra.example/mcp'

const token: {
  id: string
  kind: 'token' | 'oauth'
  app: 'chatgpt' | 'claude' | null
  name: string
  prefix: string | null
  scopes: string[]
  created_at: string
  last_used_at: string | null
  expires_at: string | null
} = {
  id: 't1',
  kind: 'token',
  app: null,
  name: 'Claude Code',
  prefix: 'spat_AbC',
  scopes: ['read'],
  created_at: '2026-11-08T00:00:00Z',
  last_used_at: null,
  expires_at: null,
}

type Change = {
  id: string
  token_id: string | null
  client: string
  capability: string
  target: string[]
  created_at: string
}

function mount(changes: Change[] = []) {
  server.use(
    http.get(`${API}/agent/mcp-changes`, ({ request }) => {
      const tokenId = new URL(request.url).searchParams.get('token_id')
      return HttpResponse.json({
        items: changes.filter((c) => tokenId === null || c.token_id === tokenId),
      })
    }),
    http.get(`${API}/auth/config`, () => HttpResponse.json({ google_client_id: null })),
    http.get(`${API}/account/reauth`, () => HttpResponse.json({ remaining_seconds: 600 })),
  )
  return renderWithRouter(
    <AuthContext.Provider value={{ user, isLoading: false, signOut: async () => {} }}>
      <SectionFrame
        section={{
          id: 'api-mcp',
          level: 'account',
          order: 0,
          title: () => 'Clients',
          component: ConnectionsSection,
        }}
      />
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

test('Claude Desktop bridges to a server on the local network over plain http', () => {
  const args = (address: string) => {
    const setup = mcpSetup('claude-desktop', address, 'spat_x')
    if (setup.kind !== 'config') throw new Error(setup.kind)
    return JSON.parse(setup.text).mcpServers.semestra.args as string[]
  }
  expect(args('http://192.168.1.5:8000/mcp')).toContain('--allow-http')
  expect(args(url)).not.toContain('--allow-http')
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
  // Apps that sign in reach the server from the internet: a local one offers Claude through
  // Claude Desktop instead.
  expect(within(dialog).queryByRole('button', { name: 'ChatGPT' })).not.toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: 'Claude' })).not.toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Claude Desktop' })).toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Claude Code' }))
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Access' }))
  await userEvent.click(await screen.findByRole('option', { name: /Read and write/ }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Create API token' }))

  expect(await screen.findByText(/claude mcp add --transport http semestra/)).toHaveTextContent(
    'Authorization: Bearer spat_SECRET',
  )
  // It says connected once the client has used the token.
  expect(screen.getByText('Waiting for Claude Code to connect…')).toBeInTheDocument()
  items[0] = { ...token, last_used_at: '2026-11-08T00:01:00Z' }
  expect(
    await screen.findByText('Claude Code is connected', undefined, { timeout: 5000 }),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(screen.queryByText(/spat_SECRET/)).not.toBeInTheDocument())
  expect(await screen.findByText('Claude Code')).toBeInTheDocument() // listed by its prefix only
})

test('a token for anything else takes a name, after confirming who you are', async () => {
  server.use(
    http.get(`${API}/account/tokens`, () => HttpResponse.json({ items: [] })),
    http.post(`${API}/account/reauth/password`, async ({ request }) =>
      ((await request.json()) as { password: string }).password === 'hunter22hunter22'
        ? HttpResponse.json({ remaining_seconds: 600 })
        : HttpResponse.json(apiError('auth.wrong_password', 400).body, { status: 400 }),
    ),
    http.post(`${API}/account/tokens`, async ({ request }) => {
      expect(((await request.json()) as { name: string }).name).toBe('CLI')
      return HttpResponse.json({ ...token, name: 'CLI', token: 'spat_SECRET' })
    }),
  )
  mount()
  // Signed in over 10 minutes ago.
  server.use(http.get(`${API}/account/reauth`, () => HttpResponse.json({ remaining_seconds: 0 })))

  await userEvent.click(await screen.findByRole('button', { name: 'New connection' }))
  const dialog = await screen.findByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Other client or script' }))
  // The confirmation takes the fields' place until it is done.
  const password = await within(dialog).findByLabelText('Password')
  const create = within(dialog).getByRole('button', { name: 'Create API token' })
  expect(create).toBeDisabled()
  await userEvent.type(password, 'wrong{Enter}')
  expect(await within(dialog).findByText('Incorrect password.')).toBeInTheDocument()
  await userEvent.clear(password)
  await userEvent.type(password, 'hunter22hunter22')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))

  await userEvent.type(await within(dialog).findByRole('textbox', { name: 'Name' }), 'CLI')
  await userEvent.click(create)
  expect(await screen.findByText('spat_SECRET')).toBeInTheDocument()
})

test('an answer that arrives after the dialog opened asks to confirm at once', async () => {
  let answer: (() => void) | undefined
  const arrived = new Promise<void>((resolve) => (answer = resolve))
  server.use(http.get(`${API}/account/tokens`, () => HttpResponse.json({ items: [] })))
  mount()
  server.use(
    http.get(`${API}/account/reauth`, async () => {
      await arrived
      return HttpResponse.json({ remaining_seconds: 0 })
    }),
  )

  await userEvent.click(await screen.findByRole('button', { name: 'New connection' }))
  const dialog = await screen.findByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Other client or script' }))
  answer?.()
  expect(await within(dialog).findByLabelText('Password', {}, { timeout: 1000 })).toBeVisible()
  expect(within(dialog).getByRole('button', { name: 'Create API token' })).toBeDisabled()
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

test('recent changes list every connection, revoked ones by name, and narrow to one', async () => {
  server.use(
    http.get(`${API}/account/tokens`, () =>
      HttpResponse.json({
        items: [
          token,
          { ...token, id: 't2', name: 'Cursor', prefix: 'spat_XyZ', scopes: ['read', 'write'] },
        ],
      }),
    ),
  )
  const change = { capability: 'grading.assessment.update', created_at: '2026-11-08T00:02:00Z' }
  mount([
    { ...change, id: 'c2', token_id: 't2', client: 'Cursor', target: ['Lab 3'] },
    { ...change, id: 'c1', token_id: null, client: 'Old laptop', target: ['Lab 2'] },
  ])
  // A read-only connection cannot change anything.
  await userEvent.click(await screen.findByRole('button', { name: 'Actions for Claude Code' }))
  expect(await screen.findByRole('menuitem', { name: 'Revoke' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: 'Recent changes' })).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')

  await userEvent.click(screen.getByRole('button', { name: 'Recent changes' }))
  let dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByText('Old laptop · Lab 2')).toBeInTheDocument()
  expect(within(dialog).getByText('Cursor · Lab 3')).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

  await userEvent.click(screen.getByRole('button', { name: 'Actions for Cursor' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Recent changes' }))
  dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByText('Lab 3')).toBeInTheDocument()
  expect(within(dialog).queryByText(/Lab 2/)).not.toBeInTheDocument()
})

test('an app that signs in gets the address and its steps, and shows once it has connected', async () => {
  const items: (typeof token)[] = [token]
  server.use(
    http.get(`${API}/account/tokens`, () => HttpResponse.json({ items })),
    http.get(`${API}/account/reauth`, () => HttpResponse.json({ remaining_seconds: 600 })),
  )
  renderWithRouter(<AddConnectionDialog open onOpenChange={() => {}} url={url} />)

  const chatgpt = await screen.findByRole('button', { name: 'ChatGPT' })
  // Claude itself signs in here, so Claude Desktop isn't offered alongside it.
  expect(screen.getByRole('button', { name: 'Claude' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Claude Desktop' })).not.toBeInTheDocument()
  await userEvent.click(chatgpt)
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(url)).toBeInTheDocument()
  expect(within(dialog).getByText('Add custom MCP server')).toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: /Create API token/ })).not.toBeInTheDocument()
  expect(within(dialog).getByText('Waiting for ChatGPT to connect…')).toBeInTheDocument()
  // Signing in on the consent page adds a connection.
  items.push({ ...token, id: 't2', kind: 'oauth', app: 'chatgpt', name: 'ChatGPT', prefix: null })
  expect(
    await within(dialog).findByText('ChatGPT is connected', undefined, { timeout: 5000 }),
  ).toBeInTheDocument()
})

test('an app that signed in is listed as such and disconnected after confirming', async () => {
  const revoked = vi.fn<(id: string) => void>()
  const chatgpt = {
    ...token,
    id: 't2',
    kind: 'oauth' as const,
    app: 'chatgpt' as const,
    name: 'ChatGPT',
    prefix: null,
  }
  server.use(
    http.get(`${API}/account/tokens`, () => HttpResponse.json({ items: [chatgpt] })),
    http.delete(`${API}/account/tokens/:id`, ({ params }) => {
      revoked(String(params.id))
      return HttpResponse.json({ ok: true })
    }),
  )
  mount()
  expect(await screen.findByText(/^Signed in · /)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Actions for ChatGPT' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Disconnect' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText('Disconnect ChatGPT?')).toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
  await waitFor(() => expect(revoked).toHaveBeenCalledWith('t2'))
})
