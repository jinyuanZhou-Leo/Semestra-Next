import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import type { CardSize } from '@/app/extensions'
import { API, renderWithQuery, server } from '@/test-utils'
import HabitBoardCard from './HabitBoardCard'
import HabitRingCard from './HabitRingCard'
import { habitSettingsSchema } from './schema'

const success = vi.hoisted(() => vi.fn<(message: string) => void>())
vi.mock('sonner', () => ({ toast: { success, error: vi.fn<(message: string) => void>() } }))

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// 2026-01-15 is a Thursday; the week starts on Monday.
const stats = {
  goal: 'daily',
  weekly_target: 3,
  current_streak: 2,
  longest_streak: 5,
  total: 9,
  period_done: 1,
  period_target: 1,
  today: '2026-01-15',
  week_start: 1,
  checked_today: true,
}
const scope = { kind: 'program', programId: 'p1' } as const
const settings = habitSettingsSchema.parse({ name: 'Read' })

function mockHabit(options: { checked: string[]; stats?: Record<string, unknown> }) {
  const toggles: string[] = []
  server.use(
    http.get(`${API}/habit/instances/i1/stats`, () =>
      HttpResponse.json({ ...stats, ...options.stats }),
    ),
    http.get(`${API}/habit/instances/i1/checkins`, () =>
      HttpResponse.json({ items: options.checked }),
    ),
    http.post(`${API}/habit/instances/i1/checkins/toggle`, async ({ request }) => {
      const body = (await request.json()) as { date: string }
      toggles.push(body.date)
      return HttpResponse.json({
        date: body.date,
        checked: !options.checked.includes(body.date),
        stats: { ...stats, ...options.stats },
      })
    }),
  )
  return toggles
}

function board(size: CardSize = 'm') {
  return renderWithQuery(
    <HabitBoardCard scope={scope} instanceId="i1" size={size} settings={settings} />,
  )
}

test('the board shows the streak and marks the checked days', async () => {
  mockHabit({ checked: ['2026-01-14', '2026-01-15'] })
  board()
  expect(await screen.findByText('2-day streak')).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: /Jan 15, 2026: done/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByRole('button', { name: /Jan 13, 2026: not done/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

test('five weeks are shown at m, ten at l and twenty at xl', async () => {
  mockHabit({ checked: [] })
  for (const [size, weeks] of [
    ['m', 5],
    ['l', 10],
    ['xl', 20],
  ] as const) {
    const { unmount } = board(size)
    await screen.findByText('2-day streak')
    expect(screen.getAllByRole('button')).toHaveLength(weeks * 7)
    unmount()
  }
})

test('days in the future and older than a week cannot be changed', async () => {
  mockHabit({ checked: [] })
  board()
  expect(await screen.findByRole('button', { name: /Jan 16, 2026/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: /Jan 7, 2026/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: /Jan 8, 2026/ })).toBeEnabled()
})

test('clicking an unchecked day checks it at once', async () => {
  const toggles = mockHabit({ checked: [] })
  board()
  await userEvent.click(await screen.findByRole('button', { name: /Jan 14, 2026: not done/ }))
  await waitFor(() => expect(toggles).toEqual(['2026-01-14']))
})

test('removing a check-in asks first', async () => {
  const toggles = mockHabit({ checked: ['2026-01-15'] })
  board()
  await userEvent.click(await screen.findByRole('button', { name: /Jan 15, 2026: done/ }))
  expect(toggles).toEqual([])
  await userEvent.click(await screen.findByRole('button', { name: 'Remove check-in' }))
  await waitFor(() => expect(toggles).toEqual(['2026-01-15']))
})

test('the ring shows weekly progress and checks in today', async () => {
  const toggles = mockHabit({
    checked: [],
    stats: { goal: 'weekly', period_done: 2, period_target: 3, checked_today: false },
  })
  renderWithQuery(
    <HabitRingCard
      scope={scope}
      instanceId="i1"
      size="m"
      settings={habitSettingsSchema.parse({ name: 'Run', goal: 'weekly' })}
    />,
  )
  expect(await screen.findByText('2/3 this week')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Run: Check in' }))
  await waitFor(() => expect(toggles).toEqual(['2026-01-15']))
})

function ringWithToggle(options: { before: number; after: number; delayMs?: number }) {
  const toggles: string[] = []
  server.use(
    http.get(`${API}/habit/instances/i1/stats`, () =>
      HttpResponse.json({
        ...stats,
        goal: 'daily',
        checked_today: false,
        current_streak: options.before,
      }),
    ),
    http.post(`${API}/habit/instances/i1/checkins/toggle`, async ({ request }) => {
      const body = (await request.json()) as { date: string }
      toggles.push(body.date)
      if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs))
      return HttpResponse.json({
        date: body.date,
        checked: true,
        stats: { ...stats, checked_today: true, current_streak: options.after },
      })
    }),
  )
  renderWithQuery(<HabitRingCard scope={scope} instanceId="i1" size="m" settings={settings} />)
  return toggles
}

test('the ring ignores a second press while the first is still being saved', async () => {
  const toggles = ringWithToggle({ before: 2, after: 3, delayMs: 150 })
  const button = await screen.findByRole('button', { name: /Check in/ })
  await userEvent.click(button)
  await waitFor(() => expect(button).toBeDisabled())
  await userEvent.click(button)
  await waitFor(() => expect(button).toBeEnabled())
  expect(toggles).toEqual(['2026-01-15'])
})

test('a milestone is announced when the streak reaches it', async () => {
  success.mockClear()
  ringWithToggle({ before: 6, after: 7 })
  await userEvent.click(await screen.findByRole('button', { name: /Check in/ }))
  await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
})

test('a check-in that leaves the streak on a milestone does not announce it again', async () => {
  success.mockClear()
  const toggles = ringWithToggle({ before: 7, after: 7 })
  await userEvent.click(await screen.findByRole('button', { name: /Check in/ }))
  await waitFor(() => expect(toggles).toHaveLength(1))
  await new Promise((r) => setTimeout(r, 50))
  expect(success).not.toHaveBeenCalled()
})
