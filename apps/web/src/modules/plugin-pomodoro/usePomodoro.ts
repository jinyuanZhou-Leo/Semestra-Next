import {
  pomodoroSessionRecordMutation,
  pomodoroSessionSummarizeOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toApiError } from '@/app/api'
import { refreshUiPrefs, updateUiPref, useUiPref } from '@/app/ui-pref'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { askNotificationPermission, playChime, showNotification, unlockAudio } from './alerts'
import type { PomodoroSettings } from './schema'
import {
  INITIAL_STATE,
  type TimerConfig,
  type TimerState,
  complete,
  formatClock,
  isFinished,
  pause,
  remainingAt,
  reset,
  skip,
  start,
} from './timer'

/** What a finished phase needs besides the timer state: copied from the card when it starts. */
export type Runtime = {
  courseId: string | null
  sound: boolean
  notify: boolean
  config: TimerConfig
}

/**
 * Which timer the status bar follows, and the page it lives on (one at a time). `runtime` lets
 * the status bar, which stays mounted on every page, end the phase when the card is not on screen.
 */
export type ActiveTimer = { instanceId: string; path: string; runtime?: Runtime }

export const ACTIVE_KEY = 'pomodoro.active'
export const stateKey = (instanceId: string) => `pomodoro.${instanceId}`

/** A phase that ended longer ago than this (a closed laptop) makes no sound or notification. */
const STALE_ALERT_MS = 60_000

export function toConfig(settings: PomodoroSettings): TimerConfig {
  return {
    focus_min: settings.focus_min,
    short_break_min: settings.short_break_min,
    long_break_min: settings.long_break_min,
    long_break_every: settings.long_break_every,
    auto_start_next: settings.auto_start_next,
  }
}

export function runtimeOf(settings: PomodoroSettings): Runtime {
  return {
    courseId: settings.course_id ?? null,
    sound: settings.sound,
    notify: settings.notify,
    config: toConfig(settings),
  }
}

const finishedPhases = new Set<string>()

type Finish = {
  instanceId: string
  path: string
  state: TimerState
  now: number
  runtime: Runtime
  setState: (state: TimerState) => void
  /** The timer the status bar follows now; another card's timer is never taken over or cleared. */
  active: ActiveTimer | null
  setActive: (active: ActiveTimer | null) => void
  record: (body: SessionBody) => void
}

type SessionBody = {
  instance_id: string
  course_id: string | null
  started_at: string
  ended_at: string
  duration_sec: number
  mode: 'focus'
}

/**
 * Ends the phase that just ran out: next phase, the finished focus session recorded, chime and
 * notification. Called by the card while it is on screen and by the status bar otherwise; each
 * end is handled once per page load, whichever gets there first.
 */
export function finishPhase(args: Finish) {
  const { instanceId, path, state, now, runtime } = args
  const key = `${instanceId}:${state.endsAt}`
  if (finishedPhases.has(key)) return
  finishedPhases.add(key)
  const done = complete(state, now, runtime.config)
  args.setState(done.state)
  if (args.active === null || args.active.instanceId === instanceId) {
    args.setActive(done.state.status === 'idle' ? null : { instanceId, path, runtime })
  }
  if (done.finished) {
    args.record({
      instance_id: instanceId,
      course_id: runtime.courseId,
      started_at: new Date(done.finished.startedAt).toISOString(),
      ended_at: new Date(done.finished.endedAt).toISOString(),
      duration_sec: done.finished.durationSec,
      mode: 'focus',
    })
  }
  if (now - (state.endsAt ?? now) < STALE_ALERT_MS) {
    if (runtime.sound) playChime()
    if (runtime.notify) {
      showNotification(
        state.mode === 'focus' ? m.pomodoro_done_focus() : m.pomodoro_done_break(),
        modeLabel(done.state.mode),
      )
    }
  }
}

const MODE_LABEL = {
  focus: () => m.pomodoro_mode_focus(),
  short_break: () => m.pomodoro_mode_short_break(),
  long_break: () => m.pomodoro_mode_long_break(),
} as const

export const modeLabel = (mode: keyof typeof MODE_LABEL) => MODE_LABEL[mode]()

export function useRecordSession() {
  const queryClient = useQueryClient()
  return useMutation({
    ...pomodoroSessionRecordMutation(),
    // A finished focus session is worth a few more tries when the network or server hiccups; the
    // backend ignores a repeat of the same start time, so retrying cannot double-count it.
    retry: (failures, error) => {
      const { status } = toApiError(error)
      return failures < 4 && (status === 0 || status >= 500)
    },
    retryDelay: (attempt) => Math.min(30_000, 1000 * 2 ** attempt),
    onError: toastError,
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: [{ _id: 'pomodoroSessionSummarize' }] }),
  })
}

/** Focus sessions and focus seconds of today, from the backend (it knows the Program's day). */
export function usePomodoroToday(programId: string) {
  const { data } = useQuery({
    ...pomodoroSessionSummarizeOptions({ query: { program_id: programId } }),
    staleTime: 30_000,
    // "Today" is the Program's day: ask again now and then, so a card left open overnight starts
    // counting the new day.
    refetchInterval: 5 * 60_000,
  })
  const today = data?.days.find((d) => d.date === data.today)
  return { sessions: today?.sessions ?? 0, focusSec: today?.focus_sec ?? 0 }
}

/**
 * The timer of one pomodoro card (M14 §3): state in a UI preference so it survives reloads and
 * page changes, a 250 ms tick while running, and the end-of-phase handling (record, alert,
 * next phase). Several tabs may show the same card; the finished session is recorded once
 * because the backend ignores a repeat of the same start time.
 */
export function usePomodoro(instanceId: string, programId: string, settings: PomodoroSettings) {
  const queryClient = useQueryClient()
  const [state, setState] = useUiPref<TimerState>(stateKey(instanceId), INITIAL_STATE)
  const [active, setActive] = useUiPref<ActiveTimer | null>(ACTIVE_KEY, null)
  const { focus_min, short_break_min, long_break_min, long_break_every, auto_start_next } = settings
  const config = useMemo(
    () => ({ focus_min, short_break_min, long_break_min, long_break_every, auto_start_next }),
    [focus_min, short_break_min, long_break_min, long_break_every, auto_start_next],
  )
  const [now, setNow] = useState(() => Date.now())
  const { mutate: recordSession } = useRecordSession()

  const latest = useRef({ state, config, settings, active })
  useEffect(() => {
    latest.current = { state, config, settings, active }
  })

  // The same timer may be open in another tab: when this tab comes back, take the latest state.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void refreshUiPrefs(queryClient, [stateKey(instanceId), ACTIVE_KEY])
      }
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [queryClient, instanceId])

  const here = useCallback(
    () => ({ instanceId, path: window.location.pathname + window.location.search }),
    [instanceId],
  )

  useEffect(() => {
    if (state.status !== 'running' || state.endsAt === null) return
    const tick = () => {
      const t = Date.now()
      setNow(t)
      const current = latest.current
      if (!isFinished(current.state, t)) return
      finishPhase({
        instanceId,
        path: here().path,
        state: current.state,
        now: t,
        // The settings as they were when the timer started, as when the status bar finishes it.
        runtime:
          current.active?.instanceId === instanceId && current.active.runtime
            ? current.active.runtime
            : runtimeOf(current.settings),
        active: current.active,
        setState,
        setActive,
        record: (body) => recordSession({ body }),
      })
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [state.status, state.endsAt, instanceId, here, setState, setActive, recordSession])

  // Only this card's own timer is dropped from the status bar, not one running on another board.
  const clearActive = () => {
    if (active?.instanceId === instanceId) setActive(null)
  }

  const remaining = remainingAt(state, now, config)

  // The tab title shows the clock while this card's timer runs.
  useEffect(() => {
    if (state.status !== 'running') return
    const original = document.title
    document.title = `${formatClock(remainingAt(state, now, config))} · ${modeLabel(state.mode)}`
    return () => {
      document.title = original
    }
  })

  return {
    state,
    now,
    remaining,
    config,
    start: () => {
      if (settings.sound) unlockAudio()
      // One timer runs at a time: the status bar follows the newest, so the earlier one stops
      // here instead of running out unwatched.
      if (active && active.instanceId !== instanceId) {
        const previous = active
        void updateUiPref<TimerState>(queryClient, stateKey(previous.instanceId), (other) =>
          other?.status === 'running'
            ? pause(other, Date.now(), previous.runtime?.config ?? config)
            : undefined,
        )
      }
      if (settings.notify && state.status === 'idle') askNotificationPermission()
      const t = Date.now()
      setNow(t)
      setState(start(state, t, config))
      setActive({ ...here(), runtime: runtimeOf(settings) })
    },
    pause: () => {
      const t = Date.now()
      setNow(t)
      setState(pause(state, t, config))
    },
    skip: () => {
      setState(skip(state, Date.now(), config))
      clearActive()
    },
    reset: () => {
      setState(reset())
      clearActive()
    },
  }
}
