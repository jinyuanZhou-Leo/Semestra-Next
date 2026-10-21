import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Info } from 'lucide-react'
import type { ReactElement } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { academicsHandlers, defaultWorld } from '@/modules/academics/test-data'
import { AuthProvider } from '@/modules/auth/AuthProvider'
import { API, renderWithRouter, server, user } from '@/test-utils'
import { type ModuleManifest, type SettingsGroup, preloadable } from '../extensions'
import { ModuleRegistry } from '../registry'
import { SettingsDialog } from './SettingsDialog'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  vi.useRealTimers()
})
afterAll(() => server.close())

beforeEach(() => {
  server.use(
    http.get(`${API}/account/me`, () => HttpResponse.json(user)),
    http.get(`${API}/me/preferences`, () => HttpResponse.json({ active_program_id: null })),
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    ...academicsHandlers(defaultWorld()),
  )
})

/** One account-level section per group, each with its own loader to watch. */
function demoModule(groups: SettingsGroup[]) {
  const loads = Object.fromEntries(
    groups.map((group) => [
      group,
      vi.fn<() => Promise<{ default: () => ReactElement }>>(() =>
        Promise.resolve({ default: () => <p>{`${group} form`}</p> }),
      ),
    ]),
  )
  const module = {
    id: 'demo',
    kind: 'core',
    name: () => 'Demo',
    icon: Info,
    settingsSections: groups.map((group, i) => ({
      id: `demo-${group}`,
      level: 'account',
      group,
      title: () => `${group} section`,
      icon: Info,
      order: i,
      component: preloadable(loads[group]!),
    })),
  } as unknown as ModuleManifest
  return { module, loads }
}

test('once idle, settings load the dialog and the group each level opens on', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const { module, loads } = demoModule(['account', 'preferences'])
  renderWithRouter(
    <ModuleRegistry value={[module]}>
      <SettingsDialog />
    </ModuleRegistry>,
  )
  expect(loads.account).not.toHaveBeenCalled()
  // jsdom has no requestIdleCallback: the fallback delay applies.
  await act(() => vi.advanceTimersByTimeAsync(2000))
  expect(loads.account).toHaveBeenCalledTimes(1)
  // Only the first group; the others load when the dialog opens.
  expect(loads.preferences).not.toHaveBeenCalled()
})

test('an open dialog loads the other groups of its level, so switching shows them at once', async () => {
  const { module, loads } = demoModule(['account', 'preferences', 'data'])
  const { router } = renderWithRouter(
    <AuthProvider>
      <ModuleRegistry value={[module]}>
        <SettingsDialog />
      </ModuleRegistry>
    </AuthProvider>,
  )
  await act(() => router.navigate({ to: '/', search: { settings: 'account' } as never }))
  expect(await screen.findByText('account form')).toBeInTheDocument()
  await waitFor(() => {
    expect(loads.preferences).toHaveBeenCalledTimes(1)
    expect(loads.data).toHaveBeenCalledTimes(1)
  })
})
