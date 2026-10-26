import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import { academicsHandlers, defaultWorld } from '@/modules/academics/test-data'
import { setLocale } from '@/paraglide/runtime'
import { routeTree } from '@/routeTree.gen'
import { API, newQueryClient, server, user } from '@/test-utils'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
// The AI sections are loaded on demand. Loading them once here, not inside a test's wait, keeps
// a cold transform on a busy runner from timing a test out.
beforeAll(async () => {
  await Promise.all([
    import('@/modules/ai/settings/sections'),
    import('@/modules/assistant/settings/sections'),
  ])
}, 60_000)
afterEach(() => {
  server.resetHandlers()
  localStorage.clear()
  setLocale('en', { reload: false })
  document.documentElement.removeAttribute('data-remounting')
})
afterAll(() => server.close())

const preferences = {
  locale: null,
  theme: 'system',
  accent: 'blue',
  time_format: 'auto',
  week_start: 0,
  reduce_motion: 'system',
  active_program_id: null,
  updated_at: null,
}

let current: typeof preferences
let patches: Record<string, unknown>[]
beforeEach(() => {
  current = { ...preferences }
  patches = []
  server.use(
    http.get(`${API}/account/me`, () => HttpResponse.json(user)),
    http.get(`${API}/healthz`, () => HttpResponse.json({ status: 'ok' })),
    http.get(`${API}/auth/config`, () => HttpResponse.json({ google_client_id: null })),
    http.get(`${API}/account/sessions`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/account/tokens`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/me/settings-schemas`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/plugins/catalog`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/ai/providers`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/agent/tools`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/agent/preferences`, () =>
      HttpResponse.json({ auto_approve: [], mcp_allow_destructive: false }),
    ),
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    http.get(`${API}/me/preferences`, () => HttpResponse.json(current)),
    http.patch(`${API}/me/preferences`, async ({ request }) => {
      const patch = (await request.json()) as Record<string, unknown>
      patches.push(patch)
      current = { ...current, ...patch }
      return HttpResponse.json(current)
    }),
    // No Programs: `/` leads to onboarding, which keeps `?settings=`.
    ...academicsHandlers({ ...defaultWorld(), programs: [] }),
  )
})

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

test('the settings dialog groups sections in a navigation and shows the chosen group', async () => {
  const router = mount('/?settings=account/preferences')
  const nav = await screen.findByRole('navigation', { name: 'Settings' })

  expect(within(nav).getByRole('button', { name: 'Account' })).toBeInTheDocument()
  expect(within(nav).getByRole('button', { name: 'Preferences' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  expect(within(nav).getByRole('button', { name: 'About' })).toBeInTheDocument()
  // Sessions and API tokens moved out of Account into Security; groups sit under headings.
  expect(within(nav).getByRole('button', { name: 'Security' })).toBeInTheDocument()
  expect(within(nav).getByText('Personal')).toBeInTheDocument()
  expect(within(nav).getByText('System')).toBeInTheDocument()
  // The sections of the open group are rendered on the right.
  expect(await screen.findByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'Language and time' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Profile' })).not.toBeInTheDocument()

  await userEvent.click(within(nav).getByRole('button', { name: 'Account' }))
  expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
  expect(router.state.location.search).toEqual({ settings: 'account/account' })
  expect(router.state.location.pathname).toBe('/onboarding')
})

test('an unknown group shows the first one instead of an empty dialog', async () => {
  mount('/?settings=account/nope')
  expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
})

test('choosing a theme and an accent color applies them at once and saves them', async () => {
  mount('/?settings=account/preferences')
  await userEvent.click(await screen.findByRole('radio', { name: /Dark/ }))
  await userEvent.click(screen.getByRole('radio', { name: 'Violet' }))

  expect(document.documentElement).toHaveClass('dark')
  expect(document.documentElement).toHaveAttribute('data-accent', 'violet')
  await waitFor(() => expect(patches).toEqual([{ theme: 'dark' }, { accent: 'violet' }]))
})

test('the saved preferences are applied when the signed-in app loads', async () => {
  current = { ...preferences, theme: 'dark', accent: 'rose', reduce_motion: 'on' }
  mount('/?settings=account/preferences')
  await screen.findByRole('navigation', { name: 'Settings' })
  await waitFor(() => expect(document.documentElement).toHaveAttribute('data-accent', 'rose'))
  expect(document.documentElement).toHaveClass('dark')
  expect(document.documentElement).toHaveAttribute('data-reduce-motion', 'on')
})

test('the saved language replaces the interface language without a reload', async () => {
  current = { ...preferences, locale: 'zh-CN' as never }
  mount('/?settings=account/preferences')
  expect(await screen.findByRole('navigation', { name: '设置' })).toBeInTheDocument()
  expect(document.documentElement.lang).toBe('zh-CN')
})

test('a language picked while signed out becomes the account language at sign-in', async () => {
  setLocale('zh-CN', { reload: false })
  localStorage.setItem('semestra.locale-chosen', '1')
  mount('/?settings=account/preferences')
  await waitFor(() => expect(patches).toEqual([{ locale: 'zh-CN' }]))
  expect(localStorage.getItem('semestra.locale-chosen')).toBeNull()
})

test('changing the language in settings switches the page and saves it', async () => {
  mount('/?settings=account/preferences')
  await userEvent.click(await screen.findByRole('combobox', { name: 'Language' }))
  await userEvent.click(await screen.findByRole('option', { name: '简体中文' }))
  // The app re-mounts in the new language; the open dialog must not play its entrance again.
  expect(document.documentElement).toHaveAttribute('data-remounting')
  expect(await screen.findByRole('navigation', { name: '设置' })).toBeInTheDocument()
  await waitFor(() => expect(patches).toEqual([{ locale: 'zh-CN' }]))
})

test('the 24-hour clock preference reaches the formatters', async () => {
  current = { ...preferences, time_format: '24h' }
  mount('/?settings=account/preferences')
  await screen.findByRole('navigation', { name: 'Settings' })
  const { formatTime } = await import('@/lib/format')
  await waitFor(() => expect(formatTime('2026-01-01T15:30:00')).toBe('15:30'))
})

test('a link to a section that moved to another group still opens that section', async () => {
  // Sessions used to live in Account; AI providers in Features.
  mount('/?settings=account/account#sessions')
  expect(await screen.findByRole('heading', { name: 'Devices' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Profile' })).not.toBeInTheDocument()
})

test('old links to the single AI page open the AI page that now holds the section', async () => {
  mount('/?settings=account/ai')
  const nav = await screen.findByRole('navigation', { name: 'Settings' })
  expect(within(nav).getByRole('button', { name: 'Providers' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  expect(within(nav).getByRole('button', { name: 'Permissions' })).toBeInTheDocument()
  // The section loads its own module and data, which takes longer than the default 1s on a
  // busy CI runner.
  expect(
    await screen.findByRole('heading', { name: 'AI providers' }, { timeout: 5000 }),
  ).toBeInTheDocument()
})

test('an old AI link with a section lands on the page holding it', async () => {
  mount('/?settings=account/ai#assistant-mcp')
  const nav = await screen.findByRole('navigation', { name: 'Settings' })
  expect(within(nav).getByRole('button', { name: 'MCP and tools' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  expect(await screen.findByRole('heading', { name: 'MCP' }, { timeout: 5000 })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'AI providers' })).not.toBeInTheDocument()
})
