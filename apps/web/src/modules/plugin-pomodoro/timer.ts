/**
 * Pomodoro timer state machine (M14 §3). Pure: every function takes the clock as an argument.
 *
 * The remaining time is always derived from `endsAt` while running, so reloads, other pages and
 * background tabs cannot make it drift. The state is small and JSON-safe because it is stored as
 * a UI preference (`pomodoro.<instanceId>`).
 */

export type Mode = 'focus' | 'short_break' | 'long_break'

export type TimerConfig = {
  focus_min: number
  short_break_min: number
  long_break_min: number
  long_break_every: number
  auto_start_next: boolean
}

export type TimerState = {
  mode: Mode
  status: 'idle' | 'running' | 'paused'
  /** Epoch ms the current run ends; only while running. */
  endsAt: number | null
  /** Time left while idle (null = the full length of the mode) or paused. */
  remainingMs: number | null
  /** Focus sessions completed since the last long break. */
  cycleIndex: number
  /** Focus mode only: when the session was first started, and the time spent before this run. */
  sessionStartedAt: number | null
  activeMs: number
  /** When the current run began, to add its length to `activeMs` on pause or completion. */
  runStartedAt: number | null
}

export type FinishedSession = {
  startedAt: number
  endedAt: number
  durationSec: number
}

export const INITIAL_STATE: TimerState = {
  mode: 'focus',
  status: 'idle',
  endsAt: null,
  remainingMs: null,
  cycleIndex: 0,
  sessionStartedAt: null,
  activeMs: 0,
  runStartedAt: null,
}

const MINUTE = 60_000

export function modeDurationMs(mode: Mode, config: TimerConfig): number {
  const minutes =
    mode === 'focus'
      ? config.focus_min
      : mode === 'short_break'
        ? config.short_break_min
        : config.long_break_min
  return minutes * MINUTE
}

/** Milliseconds left at `now`. */
export function remainingAt(state: TimerState, now: number, config: TimerConfig): number {
  if (state.status === 'running' && state.endsAt !== null) return Math.max(0, state.endsAt - now)
  return state.remainingMs ?? modeDurationMs(state.mode, config)
}

/** 0–1 of the current phase that has passed. */
export function progressAt(state: TimerState, now: number, config: TimerConfig): number {
  const total = modeDurationMs(state.mode, config)
  return total <= 0 ? 0 : Math.min(1, Math.max(0, 1 - remainingAt(state, now, config) / total))
}

export function start(state: TimerState, now: number, config: TimerConfig): TimerState {
  if (state.status === 'running') return state
  const left = remainingAt(state, now, config)
  return {
    ...state,
    status: 'running',
    endsAt: now + left,
    remainingMs: null,
    sessionStartedAt: state.mode === 'focus' ? (state.sessionStartedAt ?? now) : null,
    runStartedAt: now,
  }
}

export function pause(state: TimerState, now: number, config: TimerConfig): TimerState {
  if (state.status !== 'running') return state
  return {
    ...state,
    status: 'paused',
    endsAt: null,
    remainingMs: remainingAt(state, now, config),
    activeMs: state.activeMs + (state.runStartedAt === null ? 0 : now - state.runStartedAt),
    runStartedAt: null,
  }
}

/** The mode after `mode` ends, and the focus count it leaves. */
function next(mode: Mode, cycleIndex: number, config: TimerConfig, completed: boolean) {
  if (mode !== 'focus') return { mode: 'focus' as const, cycleIndex }
  const done = completed ? cycleIndex + 1 : cycleIndex
  return completed && done >= config.long_break_every
    ? { mode: 'long_break' as const, cycleIndex: 0 }
    : { mode: 'short_break' as const, cycleIndex: done }
}

function enter(
  mode: Mode,
  cycleIndex: number,
  now: number,
  config: TimerConfig,
  autoStart: boolean,
): TimerState {
  const idle: TimerState = { ...INITIAL_STATE, mode, cycleIndex }
  return autoStart ? start(idle, now, config) : idle
}

/** Skip to the next phase. A skipped focus session is not counted and not recorded. */
export function skip(state: TimerState, now: number, config: TimerConfig): TimerState {
  const target = next(state.mode, state.cycleIndex, config, false)
  return enter(target.mode, target.cycleIndex, now, config, false)
}

/** Back to a fresh focus session at the start of the cycle. */
export function reset(): TimerState {
  return INITIAL_STATE
}

export function isFinished(state: TimerState, now: number): boolean {
  return state.status === 'running' && state.endsAt !== null && now >= state.endsAt
}

/**
 * The timer reached zero. Returns the next state and, for a focus session, what to record. The
 * session ends at `endsAt` even when this runs late (a sleeping laptop).
 */
export function complete(
  state: TimerState,
  now: number,
  config: TimerConfig,
): { state: TimerState; finished: FinishedSession | null } {
  const endedAt = state.endsAt ?? now
  let finished: FinishedSession | null = null
  if (state.mode === 'focus' && state.sessionStartedAt !== null) {
    const active = state.activeMs + (state.runStartedAt === null ? 0 : endedAt - state.runStartedAt)
    finished = {
      startedAt: state.sessionStartedAt,
      endedAt,
      durationSec: Math.max(1, Math.round(active / 1000)),
    }
  }
  const target = next(state.mode, state.cycleIndex, config, true)
  return {
    state: enter(target.mode, target.cycleIndex, now, config, config.auto_start_next),
    finished,
  }
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
