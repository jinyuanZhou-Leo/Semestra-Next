import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { API, newQueryClient, renderWithRouter, server } from '@/test-utils'
import type { Release } from './release-notes'
import { pendingAnnouncement, WhatsNew } from './WhatsNew'

const confetti = vi.hoisted(() => vi.fn<(options: object) => Promise<null>>())
vi.mock('canvas-confetti', () => ({ default: confetti }))

const RELEASES: Release[] = [
  {
    version: '1.2.0',
    date: '2026-12-01',
    level: 'minor',
    items: [
      { kind: 'fixed', en: 'Fixed the week view.', zh: '修好了周视图。' },
      { kind: 'new', en: 'Drag categories to reorder them.', zh: '可以拖动调整分类顺序。' },
    ],
  },
  {
    version: '1.1.1',
    date: '2026-11-20',
    level: 'patch',
    items: [{ kind: 'fixed', en: 'Fixed a typo.', zh: '修了一个错别字。' }],
  },
  {
    version: '1.1.0',
    date: '2026-11-03',
    level: 'minor',
    items: [{ kind: 'improved', en: 'Smoother scrolling.', zh: '滚动更顺滑。' }],
  },
  {
    version: '1.0.0',
    date: '2026-10-22',
    level: 'major',
    items: [{ kind: 'new', en: 'Semestra 1.0.', zh: 'Semestra 1.0。' }],
  },
]

vi.mock('./release-notes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./release-notes')>()
  return {
    ...actual,
    releaseVersions: () => RELEASES.map((r) => r.version),
    loadRelease: async (version: string) => RELEASES.find((r) => r.version === version),
    releasesBetween: async (after: string, upTo: string) =>
      RELEASES.filter(
        (r) =>
          actual.compareVersions(r.version, after) > 0 &&
          actual.compareVersions(r.version, upTo) <= 0,
      ),
  }
})

beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' })
  // The dialog's code (with the settings framework) takes a few seconds to load the first time.
  await import('./WhatsNewDialog')
}, 30_000)
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
beforeEach(() => {
  confetti.mockClear()
})

function backend(stored: Record<string, unknown>) {
  const writes: [string, unknown][] = []
  server.use(
    http.post(`${API}/me/ui-state\\:get`, async ({ request }) => {
      const body = (await request.json()) as { keys?: string[]; prefixes?: string[] }
      const items = Object.fromEntries(
        Object.entries(stored).filter(
          ([key]) =>
            body.keys?.includes(key) || body.prefixes?.some((prefix) => key.startsWith(prefix)),
        ),
      )
      return HttpResponse.json({ items })
    }),
    http.put(`${API}/me/ui-state/:key`, async ({ params, request }) => {
      const { value } = (await request.json()) as { value: unknown }
      stored[String(params.key)] = value
      writes.push([String(params.key), value])
      return HttpResponse.json({ key: params.key, value })
    }),
  )
  return { stored, writes }
}

test('announces the minor and major releases since the last one seen, skipping patches', async () => {
  backend({ 'release.last_seen': '1.0.0', 'onboarding.tour_done': true })
  const { releases, more } = await pendingAnnouncement(newQueryClient(), '1.2.0')
  expect(releases.map((r) => r.version)).toEqual(['1.2.0', '1.1.0'])
  expect(more).toBe(0)
})

test('only patches since the last one seen: nothing to show, and the version is remembered', async () => {
  const state = backend({ 'release.last_seen': '1.1.0', 'onboarding.tour_done': true })
  const queryClient = newQueryClient()
  const { releases } = await pendingAnnouncement(queryClient, '1.1.1')
  expect(releases).toEqual([])
  await waitFor(() => expect(state.stored['release.last_seen']).toBe('1.1.1'))
})

test('a new account starts at the current version without an announcement', async () => {
  const state = backend({ 'onboarding.tour_done': false })
  const { releases } = await pendingAnnouncement(newQueryClient(), '1.2.0')
  expect(releases).toEqual([])
  await waitFor(() => expect(state.stored['release.last_seen']).toBe('1.2.0'))
})

test('an account from before release notes hears about everything, newest first', async () => {
  backend({ 'onboarding.tour_done': true })
  const { releases, more } = await pendingAnnouncement(newQueryClient(), '1.2.0')
  expect(releases.map((r) => r.version)).toEqual(['1.2.0', '1.1.0', '1.0.0'])
  expect(more).toBe(0)
})

test('an older tab never moves the seen version back', async () => {
  const state = backend({ 'release.last_seen': '1.2.0', 'onboarding.tour_done': true })
  const { releases } = await pendingAnnouncement(newQueryClient(), '1.1.0')
  expect(releases).toEqual([])
  expect(state.writes).toEqual([])
})

test('shows the dialog with confetti, and closing it remembers the version', async () => {
  const state = backend({ 'release.last_seen': '1.1.0', 'onboarding.tour_done': true })
  renderWithRouter(<WhatsNew version="1.2.0" />)
  const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 })
  expect(dialog).toHaveTextContent("What's new in Semestra 1.2")
  // Grouped "New" before "Fixed", whatever the order in the file.
  const headings = [...dialog.querySelectorAll('h4')].map((h) => h.textContent)
  expect(headings).toEqual(['New', 'Fixed'])
  await waitFor(() => expect(confetti).toHaveBeenCalledTimes(2))
  expect(confetti.mock.calls[0]![0]).toMatchObject({ disableForReducedMotion: true })

  await userEvent.click(screen.getByRole('button', { name: 'Got it' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await waitFor(() => expect(state.stored['release.last_seen']).toBe('1.2.0'))
})

test('waits while the tour is still due', async () => {
  backend({ 'release.last_seen': '1.1.0', 'onboarding.tour_done': false })
  renderWithRouter(<WhatsNew version="1.2.0" />)
  await new Promise((resolve) => setTimeout(resolve, 900))
  expect(screen.queryByRole('dialog')).toBeNull()
})
