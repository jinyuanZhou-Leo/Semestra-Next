import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useSmoothedProgress } from './use-smoothed-progress'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('catches up with real progress and creeps while it stalls', () => {
  const { result, rerender } = renderHook(({ p, running }) => useSmoothedProgress(p, running), {
    initialProps: { p: 0, running: true },
  })
  rerender({ p: 50, running: true })
  act(() => vi.advanceTimersByTime(3_000))
  expect(result.current).toBeGreaterThan(49)
  expect(result.current).toBeLessThan(51)
  act(() => vi.advanceTimersByTime(30_000))
  expect(result.current).toBe(55)

  rerender({ p: 10, running: true }) // a new task: no creeping down from 55
  expect(result.current).toBe(10)
  rerender({ p: 10, running: false })
  expect(result.current).toBe(10)
})
