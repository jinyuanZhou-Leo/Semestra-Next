import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { API, newQueryClient, server } from '@/test-utils'
import { QueryClientProvider } from '@tanstack/react-query'
import { usePomodoroStatus } from './status'

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-15T12:00:00Z') })
})
afterEach(() => vi.useRealTimers())

const phase = 25 * 60_000

function withStored(items: Record<string, unknown>) {
  server.use(
    http.post(`${API}/me/ui-state\\:get`, () => HttpResponse.json({ items })),
    http.put(`${API}/me/ui-state/:key`, () => HttpResponse.json({})),
  )
  const client = newQueryClient()
  return renderHook(() => usePomodoroStatus(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

const base = {
  mode: 'focus',
  endsAt: null,
  remainingMs: null,
  phaseMs: phase,
  cycleIndex: 0,
  sessionStartedAt: null,
  activeMs: 0,
  runStartedAt: null,
}

test('there is no status line while no timer was started', () => {
  const { result } = withStored({})
  expect(result.current).toBeNull()
})

test('a running timer shows its mode and time left and links back to its page', async () => {
  const { result } = withStored({
    'pomodoro.active': { instanceId: 'i1', path: '/p/p1' },
    'pomodoro.i1': { ...base, status: 'running', endsAt: Date.now() + 10 * 60_000 },
  })
  await waitFor(() => expect(result.current).not.toBeNull())
  expect(result.current?.label).toBe('Focus 10:00')
  expect(result.current?.to).toBe('/p/p1')
  expect(result.current?.progress).toBe(60)
})

test('a paused timer stays in the status line', async () => {
  const { result } = withStored({
    'pomodoro.active': { instanceId: 'i1', path: '/p/p1' },
    'pomodoro.i1': { ...base, status: 'paused', remainingMs: 5 * 60_000 },
  })
  await waitFor(() => expect(result.current).not.toBeNull())
  expect(result.current?.label).toContain('Focus 05:00')
  expect(result.current?.label).toContain('paused')
})

test('an idle timer is not shown', async () => {
  const { result } = withStored({
    'pomodoro.active': { instanceId: 'i1', path: '/p/p1' },
    'pomodoro.i1': { ...base, status: 'idle' },
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(result.current).toBeNull()
})
