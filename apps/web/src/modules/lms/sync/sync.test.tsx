import type { SyncItem, SyncStatus } from '@semestra/api-client'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { API, renderWithRouter, server } from '@/test-utils'
import { Popover, PopoverContent } from '@/ui/popover'
import SyncPanel from './SyncPanel'
import { SyncOnOpen } from './SyncOnOpen'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const IN_PROGRAM = { path: '/p/$programId', at: '/p/p1' }

/** The panel where the status line shows it. */
function InPopover() {
  return (
    <Popover open>
      <PopoverContent>
        <SyncPanel onClose={() => undefined} />
      </PopoverContent>
    </Popover>
  )
}

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
    http.get(`${API}/programs/p1/courses`, () =>
      HttpResponse.json({ items: [], next_cursor: null }),
    ),
  ]
}

test('opening a Program syncs it; new assignments wait in the panel and can be ignored', async () => {
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
      <SyncOnOpen />
      <InPopover />
    </>,
    undefined,
    IN_PROGRAM,
  )
  expect(await screen.findByText('A3, Lab 9')).toBeInTheDocument()
  await waitFor(() => expect(requested).toHaveBeenCalledWith({}))
  await userEvent.click(screen.getByRole('button', { name: 'Ignore' }))
  await waitFor(() =>
    expect(dismissed).toHaveBeenCalledWith({ item_ids: ['r1', 'r2'], dismissed: true }),
  )
})

test('a value changed on both sides is settled from the panel', async () => {
  const conflict = item({
    id: 'r1',
    title: 'A3',
    kind: 'conflict',
    conflicts: [{ field: 'weight', mine: 10, platform: 15, edited: true }],
  })
  const resolved = vi.fn<(body: unknown) => void>()
  server.use(
    ...handlers(status({ pending: [conflict] })),
    http.post(`${API}/lms/sync/items/r1\\:resolve`, async ({ request }) => {
      resolved(await request.json())
      return HttpResponse.json(status())
    }),
  )
  renderWithRouter(<InPopover />, undefined, IN_PROGRAM)
  expect(await screen.findByText('You changed this')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Keep' }))
  await waitFor(() => expect(resolved).toHaveBeenCalledWith({ choice: 'mine' }))
  // Folded away, then gone.
  await waitFor(() => expect(screen.queryByText('To review')).not.toBeInTheDocument())
})

test('a change the sync made is undone from the panel, and so is undoing it', async () => {
  const change = {
    id: 'ch1',
    course_id: 'c1',
    course: 'CSC148',
    title: 'A3',
    field: 'title',
    old: 'A3',
    new: 'A3 (revised)',
    at: new Date().toISOString(),
    reverted: false,
    toggleable: true,
  }
  const calls = vi.fn<(url: string) => void>()
  server.use(
    ...handlers(status({ recent: [change] })),
    http.post(`${API}/lms/sync/changes/ch1\\:revert`, ({ request }) => {
      calls(request.url)
      return HttpResponse.json(status({ recent: [{ ...change, reverted: true }] }))
    }),
    http.post(`${API}/lms/sync/changes/ch1\\:reapply`, ({ request }) => {
      calls(request.url)
      return HttpResponse.json(status({ recent: [change] }))
    }),
  )
  renderWithRouter(<InPopover />, undefined, IN_PROGRAM)
  await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
  expect(await screen.findByText('Undone')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Redo' }))
  await waitFor(() => expect(screen.queryByText('Undone')).not.toBeInTheDocument())
  expect(calls.mock.calls.map(([url]) => url.split(':').at(-1))).toEqual(['revert', 'reapply'])
})

test('a connection that stopped working says so and goes to its settings from the panel', async () => {
  server.use(
    ...handlers(
      status({
        connection_error: 'lms.invalid_credentials',
        pending: [item({ id: 'r1', title: 'A3' })],
      }),
    ),
  )
  renderWithRouter(<InPopover />, undefined, IN_PROGRAM)
  expect(await screen.findByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument()
  // What waits is shown but cannot be acted on until the connection works again.
  expect(screen.getByText('A3').closest('[inert]')).not.toBeNull()
})
