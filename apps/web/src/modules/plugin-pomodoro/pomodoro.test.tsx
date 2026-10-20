import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { API, renderWithQuery, server } from '@/test-utils'
import PomodoroCard from './PomodoroCard'
import { pomodoroSettingsSchema } from './schema'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  vi.useRealTimers()
})
afterAll(() => server.close())

// Only the clock and intervals are fake: timeouts must stay real for the network mocks.
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setInterval', 'clearInterval'],
    now: new Date('2026-01-15T12:00:00Z'),
  })
})

const scope = { kind: 'program', programId: 'p1' } as const
const stored: Record<string, unknown> = {}
const recorded: Record<string, unknown>[] = []

function backend() {
  for (const key of Object.keys(stored)) delete stored[key]
  recorded.length = 0
  server.use(
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items: stored })),
    http.put(`${API}/me/ui-state/:key`, async ({ params, request }) => {
      const { value } = (await request.json()) as { value: unknown }
      stored[String(params.key)] = value
      return HttpResponse.json({ key: params.key, value })
    }),
    http.get(`${API}/pomodoro/stats`, () =>
      HttpResponse.json({
        from_date: '2026-01-09',
        to_date: '2026-01-15',
        today: '2026-01-15',
        timezone: 'UTC',
        total_focus_sec: 3000,
        total_sessions: 2,
        days: [{ date: '2026-01-15', focus_sec: 3000, sessions: 2 }],
        by_course: [],
      }),
    ),
    http.post(`${API}/pomodoro/sessions`, async ({ request }) => {
      recorded.push((await request.json()) as Record<string, unknown>)
      return HttpResponse.json({ id: 's1', duplicate: false })
    }),
  )
}

function card(overrides: Record<string, unknown> = {}, size: 's' | 'm' | 'l' = 'm') {
  return renderWithQuery(
    <PomodoroCard
      scope={scope}
      instanceId="i1"
      size={size}
      settings={pomodoroSettingsSchema.parse({ notify: false, sound: false, ...overrides })}
    />,
  )
}

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

test('shows the full focus length and counts down while running', async () => {
  backend()
  card()
  expect(screen.getByLabelText('Focus 25:00')).toBeInTheDocument()
  await userEvent
    .setup({ advanceTimers: vi.advanceTimersByTime })
    .click(screen.getByRole('button', { name: 'Start' }))
  advance(5 * 60_000)
  expect(screen.getByLabelText('Focus 20:00')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
})

test('pausing freezes the clock and shows today’s count', async () => {
  backend()
  card()
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  await user.click(screen.getByRole('button', { name: 'Start' }))
  advance(60_000)
  await user.click(screen.getByRole('button', { name: 'Pause' }))
  advance(10 * 60_000)
  expect(screen.getByLabelText('Focus 24:00')).toBeInTheDocument()
  expect(await screen.findByText('Today: 2 done', {}, { timeout: 4000 })).toBeInTheDocument()
})

test('a finished focus session is recorded and the break begins', async () => {
  backend()
  card({ focus_min: 1 })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  await user.click(screen.getByRole('button', { name: 'Start' }))
  advance(61_000)
  // Testing Library's waitFor polls with the (faked) setInterval; vi.waitFor does not.
  await vi.waitFor(() => expect(recorded).toHaveLength(1))
  expect(recorded[0]).toMatchObject({
    instance_id: 'i1',
    mode: 'focus',
    duration_sec: 60,
    started_at: '2026-01-15T12:00:00.000Z',
    ended_at: '2026-01-15T12:01:00.000Z',
  })
  expect(screen.getByLabelText('Short break 05:00')).toBeInTheDocument()
})

test('a timer left running in storage continues after a reload', async () => {
  backend()
  // Let the debounced preference writes of the previous test land first.
  await new Promise((resolve) => setTimeout(resolve, 400))
  const endsAt = Date.now() + 10 * 60_000
  stored['pomodoro.i1'] = {
    mode: 'focus',
    status: 'running',
    endsAt,
    remainingMs: null,
    phaseMs: 25 * 60_000,
    cycleIndex: 0,
    sessionStartedAt: Date.now() - 15 * 60_000,
    activeMs: 0,
    runStartedAt: Date.now() - 15 * 60_000,
  }
  card()
  expect(await screen.findByLabelText('Focus 10:00', {}, { timeout: 4000 })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
})

test('the small size is usable with start, skip and reset', async () => {
  backend()
  card({}, 's')
  expect(screen.getByLabelText('Focus 25:00')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Skip to the next phase' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
})

test('a tab that comes back shows the timer as another tab left it', async () => {
  backend()
  card()
  expect(await screen.findByLabelText('Focus 25:00', {}, { timeout: 4000 })).toBeInTheDocument()
  // Another tab started the timer.
  stored['pomodoro.i1'] = {
    mode: 'focus',
    status: 'running',
    endsAt: Date.now() + 10 * 60_000,
    remainingMs: null,
    phaseMs: 25 * 60_000,
    cycleIndex: 0,
    sessionStartedAt: Date.now() - 15 * 60_000,
    activeMs: 0,
    runStartedAt: Date.now() - 15 * 60_000,
  }
  act(() => void window.dispatchEvent(new Event('focus')))
  await vi.waitFor(() => expect(screen.getByLabelText('Focus 10:00')).toBeInTheDocument())
})

test('resetting an idle card leaves another running timer in the status bar', async () => {
  backend()
  // Let the debounced preference writes of the previous test land before the pointer is set.
  await new Promise((resolve) => setTimeout(resolve, 400))
  stored['pomodoro.active'] = { instanceId: 'other', path: '/p/p2' }
  card()
  expect(await screen.findByLabelText('Focus 25:00', {}, { timeout: 4000 })).toBeInTheDocument()
  await userEvent
    .setup({ advanceTimers: vi.advanceTimersByTime })
    .click(screen.getByRole('button', { name: 'Reset' }))
  // Writes to the preference are debounced, so wait for the stored pointer to settle.
  await act(() => vi.advanceTimersByTimeAsync(0))
  await new Promise((resolve) => setTimeout(resolve, 500))
  expect(stored['pomodoro.active']).toEqual({ instanceId: 'other', path: '/p/p2' })
})

test('starting a timer stops the one still running on another card, so none runs out unwatched', async () => {
  backend()
  await new Promise((resolve) => setTimeout(resolve, 400))
  stored['pomodoro.active'] = { instanceId: 'other', path: '/p/p2' }
  stored['pomodoro.other'] = {
    mode: 'focus',
    status: 'running',
    endsAt: Date.now() + 10 * 60_000,
    remainingMs: null,
    phaseMs: 25 * 60_000,
    cycleIndex: 0,
    sessionStartedAt: Date.now() - 15 * 60_000,
    activeMs: 0,
    runStartedAt: Date.now() - 15 * 60_000,
  }
  card()
  expect(await screen.findByLabelText('Focus 25:00', {}, { timeout: 4000 })).toBeInTheDocument()
  await userEvent
    .setup({ advanceTimers: vi.advanceTimersByTime })
    .click(screen.getByRole('button', { name: 'Start' }))
  await act(() => vi.advanceTimersByTimeAsync(0))
  await vi.waitFor(
    () => {
      expect(stored['pomodoro.other']).toMatchObject({ status: 'paused', remainingMs: 10 * 60_000 })
      expect(stored['pomodoro.active']).toMatchObject({ instanceId: 'i1' })
    },
    { timeout: 3000 },
  )
})
