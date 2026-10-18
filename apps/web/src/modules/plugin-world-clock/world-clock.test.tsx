import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { worldClockSettingsSchema } from './schema'
import WorldClockCard from './WorldClockCard'
import WorldClockSettingsForm from './WorldClockSettingsForm'

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-01-15T12:00:30Z') })
  vi.stubEnv('TZ', 'America/Toronto')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const scope = { kind: 'program', programId: 'p1' } as const

function card(settings: Record<string, unknown>, size: 's' | 'm' = 'm') {
  return render(
    <WorldClockCard
      scope={scope}
      instanceId="c1"
      size={size}
      settings={worldClockSettingsSchema.parse(settings)}
    />,
  )
}

test('shows each chosen city with its local time and date', () => {
  card({ zones: ['Asia/Tokyo', 'Europe/London'], show_offset: false })
  expect(screen.getByText('Tokyo')).toBeInTheDocument()
  expect(screen.getByText(/9:00\s?PM/)).toBeInTheDocument()
  expect(screen.getByText('London')).toBeInTheDocument()
  expect(screen.getByText(/12:00\s?PM/)).toBeInTheDocument()
})

test('the small size shows only the first city', () => {
  card({ zones: ['Asia/Tokyo', 'Europe/London'] }, 's')
  expect(screen.getByText('Tokyo')).toBeInTheDocument()
  expect(screen.queryByText('London')).toBeNull()
})

test('the difference from the local zone is shown on request', () => {
  vi.stubEnv('TZ', 'UTC')
  card({ zones: ['Asia/Kolkata'], show_offset: true })
  expect(screen.getByText(/5h 30m ahead/)).toBeInTheDocument()
})

test('the clock changes on the minute, and every second when seconds are shown', () => {
  card({ zones: ['UTC'] })
  expect(screen.getByText(/12:00\s?PM/)).toBeInTheDocument()
  act(() => void vi.advanceTimersByTime(31_000))
  expect(screen.getByText(/12:01\s?PM/)).toBeInTheDocument()
})

test('seconds tick', () => {
  card({ zones: ['UTC'], show_seconds: true })
  expect(screen.getByText(/12:00:30/)).toBeInTheDocument()
  act(() => void vi.advanceTimersByTime(3000))
  expect(screen.getByText(/12:00:3[23]/)).toBeInTheDocument()
})

test('a card without a city shows the browser zone', () => {
  card({})
  expect(screen.getByText('Toronto')).toBeInTheDocument()
})

test('cities are added by searching and limited to three', async () => {
  vi.useRealTimers()
  const user = userEvent.setup()
  const changes: unknown[] = []
  const { rerender } = render(
    <WorldClockSettingsForm
      value={worldClockSettingsSchema.parse({})}
      onChange={(v) => changes.push(v)}
    />,
  )
  await user.type(screen.getByRole('textbox', { name: 'Add a city' }), 'tokyo')
  await user.click(screen.getByRole('button', { name: /Tokyo/ }))
  expect(changes.at(-1)).toMatchObject({ zones: ['Asia/Tokyo'] })

  rerender(
    <WorldClockSettingsForm
      value={worldClockSettingsSchema.parse({ zones: ['UTC', 'Asia/Tokyo', 'Europe/Paris'] })}
      onChange={(v) => changes.push(v)}
    />,
  )
  expect(screen.getByRole('textbox', { name: 'Add a city' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Remove Tokyo' }))
  expect(changes.at(-1)).toMatchObject({ zones: ['UTC', 'Europe/Paris'] })
})

test('the schema rejects zones that do not exist, so they never reach Intl', () => {
  expect(worldClockSettingsSchema.safeParse({ zones: ['Not/AZone'] }).success).toBe(false)
  expect(worldClockSettingsSchema.safeParse({ zones: ['Asia/Tokyo'] }).success).toBe(true)
  // Settings saved before the check fall back to the defaults instead of crashing the card.
  expect(worldClockSettingsSchema.safeParse({}).data?.zones).toEqual([])
})
