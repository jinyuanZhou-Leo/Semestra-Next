import type { SyncItem, SyncStatus } from '@semestra/api-client'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { API, renderWithRouter, server } from '@/test-utils'
import { Toaster } from '@/ui/sonner'
import SyncPanel from './SyncPanel'
import { SyncToasts } from './SyncToasts'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const IN_PROGRAM = { path: '/p/$programId', at: '/p/p1' }

function item(overrides: Partial<SyncItem> & Pick<SyncItem, 'id' | 'title'>): SyncItem {
  return {
    course_id: 'c1',
    course: 'CSC148',
    kind: 'new',
    external_id: overrides.id,
    due_at: null,
    conflicts: [],
    ...overrides,
  }
}

function status(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    program_id: 'p1',
    provider: 'canvas',
    connection_name: 'U of T Quercus',
    connection_error: null,
    every: '6h',
    courses: 2,
    synced_at: new Date().toISOString(),
    syncing: false,
    pending: [],
    ignored: [],
    recent: [],
    errors: [],
    ...overrides,
  }
}

function handlers(current: SyncStatus) {
  return [
    http.get(`${API}/programs/p1/lms/sync`, () => HttpResponse.json(current)),
    http.get(`${API}/lms/providers`, () =>
      HttpResponse.json({
        items: [
          {
            kind: 'canvas',
            display_name: 'Canvas',
            features: [],
            config_schema: {},
            credentials_schema: {},
            sign_in: false,
          },
        ],
      }),
    ),
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: {} })),
    http.put(`${API}/me/ui-state/:key`, () => HttpResponse.json({ ok: true })),
  ]
}

test('opening a Program syncs it; new assignments come as a toast that can be ignored', async () => {
  const current = status({
    pending: [item({ id: 'r1', title: 'A3' }), item({ id: 'r2', title: 'Lab 9' })],
  })
  const requested = vi.fn<(body: unknown) => void>()
  const dismissed = vi.fn<(body: unknown) => void>()
  server.use(
    ...handlers(current),
    http.post(`${API}/programs/p1/lms/sync`, async ({ request }) => {
      requested(await request.json())
      return HttpResponse.json({ queued: 0 })
    }),
    http.post(`${API}/programs/p1/lms/sync\\:dismiss`, async ({ request }) => {
      dismissed(await request.json())
      return HttpResponse.json(status({ ignored: current.pending }))
    }),
  )
  renderWithRouter(
    <>
      <Toaster />
      <SyncToasts />
    </>,
    undefined,
    IN_PROGRAM,
  )
  expect(await screen.findByText('New assignments on Canvas')).toBeInTheDocument()
  expect(screen.getByText('CSC148 A3, Lab 9')).toBeInTheDocument()
  expect(requested).toHaveBeenCalledWith({})
  // A click alone: sonner's swipe handling needs pointer capture, which jsdom lacks.
  fireEvent.click(screen.getByRole('button', { name: 'Ignore' }))
  await waitFor(() => expect(dismissed).toHaveBeenCalledWith({ item_ids: ['r1', 'r2'] }))
})

test('a value changed on both sides is settled from the panel', async () => {
  const conflict = item({
    id: 'r1',
    title: 'A3',
    kind: 'conflict',
    conflicts: [{ field: 'weight', mine: 10, platform: 15 }],
  })
  const resolved = vi.fn<(body: unknown) => void>()
  server.use(
    ...handlers(status({ pending: [conflict] })),
    http.post(`${API}/lms/sync/items/r1\\:resolve`, async ({ request }) => {
      resolved(await request.json())
      return HttpResponse.json(status())
    }),
  )
  renderWithRouter(<SyncPanel onClose={() => undefined} />, undefined, IN_PROGRAM)
  expect(await screen.findByText('Yours: 10% · Canvas: 15%')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Keep mine' }))
  await waitFor(() => expect(resolved).toHaveBeenCalledWith({ choice: 'mine' }))
  expect(await screen.findByText('Nothing changed in the last 14 days')).toBeInTheDocument()
  expect(screen.queryByText('To review')).not.toBeInTheDocument()
})
