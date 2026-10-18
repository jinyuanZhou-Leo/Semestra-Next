import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import { setLocale } from '@/paraglide/runtime'
import { routeTree } from '@/routeTree.gen'
import { API, newQueryClient, server, user } from '@/test-utils'

beforeAll(() => server.listen())
afterEach(() => {
  server.resetHandlers()
  localStorage.clear()
  setLocale('en', { reload: false })
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
    http.get(`${API}/settings/schemas`, () => HttpResponse.json({ items: [] })),
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    http.get(`${API}/me/preferences`, () => HttpResponse.json(current)),
    http.patch(`${API}/me/preferences`, async ({ request }) => {
      const patch = (await request.json()) as Record<string, unknown>
      patches.push(patch)
      current = { ...current, ...patch }
      return HttpResponse.json(current)
    }),
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

test('the settings page groups sections in a navigation and shows the chosen group', async () => {
  const router = mount('/settings/preferences')
  const nav = await screen.findByRole('navigation', { name: 'Settings' })

  expect(within(nav).getByRole('link', { name: 'Account' })).toBeInTheDocument()
  expect(within(nav).getByRole('link', { name: 'Preferences' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  expect(within(nav).getByRole('link', { name: 'About' })).toBeInTheDocument()
  // The sections of the open group are listed under it and rendered on the right.
  expect(within(nav).getByRole('link', { name: 'Appearance' })).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'Language and time' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Profile' })).not.toBeInTheDocument()

  await userEvent.click(within(nav).getByRole('link', { name: 'Account' }))
  expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/settings/account')
})

test('an unknown group shows the first one instead of an empty page', async () => {
  mount('/settings/nope')
  expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
})

test('choosing a theme and an accent color applies them at once and saves them', async () => {
  mount('/settings/preferences')
  await userEvent.click(await screen.findByRole('radio', { name: /Dark/ }))
  await userEvent.click(screen.getByRole('radio', { name: 'Violet' }))

  expect(document.documentElement).toHaveClass('dark')
  expect(document.documentElement).toHaveAttribute('data-accent', 'violet')
  await waitFor(() => expect(patches).toEqual([{ theme: 'dark' }, { accent: 'violet' }]))
})

test('the saved preferences are applied when the signed-in app loads', async () => {
  current = { ...preferences, theme: 'dark', accent: 'rose', reduce_motion: 'on' }
  mount('/settings/preferences')
  await screen.findByRole('navigation', { name: 'Settings' })
  await waitFor(() => expect(document.documentElement).toHaveAttribute('data-accent', 'rose'))
  expect(document.documentElement).toHaveClass('dark')
  expect(document.documentElement).toHaveAttribute('data-reduce-motion', 'on')
})

test('the saved language replaces the interface language without a reload', async () => {
  current = { ...preferences, locale: 'zh-CN' as never }
  mount('/settings/preferences')
  expect(await screen.findByRole('navigation', { name: '设置' })).toBeInTheDocument()
  expect(document.documentElement.lang).toBe('zh-CN')
})

test('a language picked while signed out becomes the account language at sign-in', async () => {
  setLocale('zh-CN', { reload: false })
  localStorage.setItem('semestra.locale-chosen', '1')
  mount('/settings/preferences')
  await waitFor(() => expect(patches).toEqual([{ locale: 'zh-CN' }]))
  expect(localStorage.getItem('semestra.locale-chosen')).toBeNull()
})

test('changing the language in settings switches the page and saves it', async () => {
  mount('/settings/preferences')
  await userEvent.click(await screen.findByRole('combobox', { name: 'Language' }))
  await userEvent.click(await screen.findByRole('option', { name: '简体中文' }))
  expect(await screen.findByRole('navigation', { name: '设置' })).toBeInTheDocument()
  await waitFor(() => expect(patches).toEqual([{ locale: 'zh-CN' }]))
})

test('the 24-hour clock preference reaches the formatters', async () => {
  current = { ...preferences, time_format: '24h' }
  mount('/settings/preferences')
  await screen.findByRole('navigation', { name: 'Settings' })
  const { formatTime } = await import('@/lib/format')
  await waitFor(() => expect(formatTime('2026-01-01T15:30:00')).toBe('15:30'))
})
