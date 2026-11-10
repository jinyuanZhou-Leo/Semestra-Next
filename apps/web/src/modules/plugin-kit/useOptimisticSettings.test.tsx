import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useOptimisticSettings } from './useOptimisticSettings'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

type Settings = { text: string; other: number }
const incoming: Settings = { text: 'a', other: 0 }

test('a failed save rolls its own changes back and reports an error', async () => {
  const save = vi
    .fn<(patch: Partial<Settings>) => Promise<void>>()
    .mockRejectedValue(new Error('x'))
  const { result } = renderHook(() => useOptimisticSettings(incoming, save, 100))
  act(() => result.current.update({ text: 'b' }))
  expect(result.current.value.text).toBe('b')
  await act(() => vi.advanceTimersByTimeAsync(100))
  expect(result.current.value.text).toBe('a')
  expect(result.current.status).toBe('error')
})

test('an edit made while a save fails is kept and sent on its own', async () => {
  let fail!: (error: Error) => void
  const save = vi
    .fn<(patch: Partial<Settings>) => Promise<void>>()
    .mockImplementationOnce(() => new Promise<void>((_, reject) => (fail = reject)))
    .mockResolvedValue(undefined)
  const { result } = renderHook(() => useOptimisticSettings(incoming, save, 100))
  act(() => result.current.update({ text: 'b' }))
  await act(() => vi.advanceTimersByTimeAsync(100))
  expect(save).toHaveBeenCalledTimes(1)
  // The user keeps typing while the first request is still out.
  act(() => result.current.update({ other: 5 }))
  await act(async () => fail(new Error('x')))
  expect(result.current.value).toEqual({ text: 'a', other: 5 })
  await act(() => vi.advanceTimersByTimeAsync(100))
  expect(save).toHaveBeenLastCalledWith({ other: 5 })
})

test('a change whose save has not started yet stays visible when the save before it succeeds', async () => {
  let finish!: () => void
  let finishSecond!: () => void
  const save = vi
    .fn<(patch: Partial<Settings>) => Promise<void>>()
    .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
    .mockImplementationOnce(() => new Promise<void>((resolve) => (finishSecond = resolve)))
  const { result } = renderHook(() => useOptimisticSettings(incoming, save, 100))
  act(() => result.current.update({ other: 1 }))
  await act(() => vi.advanceTimersByTimeAsync(100))
  // A second change's delay runs out while the first request is still out: it is queued behind it.
  act(() => result.current.update({ other: 2 }))
  await act(() => vi.advanceTimersByTimeAsync(100))
  expect(save).toHaveBeenCalledTimes(1)
  await act(async () => finish())
  expect(save).toHaveBeenCalledTimes(2)
  expect(result.current.value.other).toBe(2)
  expect(result.current.status).toBe('saving')
  await act(async () => finishSecond())
  expect(result.current.status).toBe('idle')
})
