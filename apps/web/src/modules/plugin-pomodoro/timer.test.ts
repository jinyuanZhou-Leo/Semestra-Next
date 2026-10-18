import { expect, test } from 'vitest'
import {
  INITIAL_STATE,
  type TimerConfig,
  complete,
  formatClock,
  isFinished,
  modeDurationMs,
  pause,
  progressAt,
  remainingAt,
  reset,
  skip,
  start,
} from './timer'

const config: TimerConfig = {
  focus_min: 25,
  short_break_min: 5,
  long_break_min: 15,
  long_break_every: 4,
  auto_start_next: false,
}
const MIN = 60_000
const T0 = 1_700_000_000_000

test('a fresh timer shows the full focus length and does not move', () => {
  expect(remainingAt(INITIAL_STATE, T0, config)).toBe(25 * MIN)
  expect(remainingAt(INITIAL_STATE, T0 + 10 * MIN, config)).toBe(25 * MIN)
})

test('the remaining time comes from the end time, so it survives reloads', () => {
  const running = start(INITIAL_STATE, T0, config)
  expect(running.endsAt).toBe(T0 + 25 * MIN)
  expect(remainingAt(running, T0 + 5 * MIN, config)).toBe(20 * MIN)
  // The stored state is all a reloaded page needs.
  const reloaded = JSON.parse(JSON.stringify(running))
  expect(remainingAt(reloaded, T0 + 20 * MIN, config)).toBe(5 * MIN)
  expect(progressAt(running, T0 + 5 * MIN, config)).toBeCloseTo(0.2)
})

test('pausing keeps the time left and resuming continues from it', () => {
  const running = start(INITIAL_STATE, T0, config)
  const paused = pause(running, T0 + 10 * MIN, config)
  expect(paused.status).toBe('paused')
  expect(remainingAt(paused, T0 + 99 * MIN, config)).toBe(15 * MIN)
  const resumed = start(paused, T0 + 30 * MIN, config)
  expect(resumed.endsAt).toBe(T0 + 45 * MIN)
  expect(resumed.sessionStartedAt).toBe(T0)
})

test('completing a focus session reports its start, end and active time without pauses', () => {
  let state = start(INITIAL_STATE, T0, config)
  state = pause(state, T0 + 10 * MIN, config)
  state = start(state, T0 + 30 * MIN, config)
  expect(isFinished(state, T0 + 44 * MIN)).toBe(false)
  expect(isFinished(state, T0 + 45 * MIN)).toBe(true)
  const { state: after, finished } = complete(state, T0 + 45 * MIN, config)
  expect(finished).toEqual({ startedAt: T0, endedAt: T0 + 45 * MIN, durationSec: 25 * 60 })
  expect(after).toMatchObject({ mode: 'short_break', status: 'idle', cycleIndex: 1 })
  expect(remainingAt(after, T0 + 46 * MIN, config)).toBe(5 * MIN)
})

test('a late completion still ends the session at the planned time', () => {
  const state = start(INITIAL_STATE, T0, config)
  const { finished } = complete(state, T0 + 3 * 60 * MIN, config)
  expect(finished?.endedAt).toBe(T0 + 25 * MIN)
  expect(finished?.durationSec).toBe(25 * 60)
})

test('every fourth focus session is followed by a long break, then the cycle restarts', () => {
  let state = INITIAL_STATE
  const modes: string[] = []
  for (let i = 0; i < 5; i++) {
    state = complete(start(state, T0, config), T0 + 25 * MIN, config).state
    modes.push(state.mode)
    state = complete(start(state, T0, config), T0 + 5 * MIN, config).state // the break ends
  }
  expect(modes).toEqual(['short_break', 'short_break', 'short_break', 'long_break', 'short_break'])
})

test('breaks record nothing and lead back to focus', () => {
  const brk = { ...INITIAL_STATE, mode: 'short_break' as const, cycleIndex: 2 }
  const { state, finished } = complete(start(brk, T0, config), T0 + 5 * MIN, config)
  expect(finished).toBeNull()
  expect(state).toMatchObject({ mode: 'focus', status: 'idle', cycleIndex: 2 })
})

test('auto start begins the next phase at once', () => {
  const auto = { ...config, auto_start_next: true }
  const { state } = complete(start(INITIAL_STATE, T0, auto), T0 + 25 * MIN, auto)
  expect(state).toMatchObject({ mode: 'short_break', status: 'running' })
  expect(state.endsAt).toBe(T0 + 30 * MIN)
})

test('skipping moves on without counting the focus session', () => {
  const running = start(INITIAL_STATE, T0, config)
  const skipped = skip(running, T0 + MIN, config)
  expect(skipped).toMatchObject({ mode: 'short_break', status: 'idle', cycleIndex: 0 })
  expect(skip(skipped, T0 + 2 * MIN, config)).toMatchObject({ mode: 'focus', cycleIndex: 0 })
})

test('reset returns to a fresh focus session', () => {
  expect(reset()).toEqual(INITIAL_STATE)
})

test('durations follow the settings, and the clock is zero padded', () => {
  expect(modeDurationMs('long_break', { ...config, long_break_min: 20 })).toBe(20 * MIN)
  expect(formatClock(25 * MIN)).toBe('25:00')
  expect(formatClock(61_000)).toBe('01:01')
  expect(formatClock(59_001)).toBe('01:00')
  expect(formatClock(0)).toBe('00:00')
})
