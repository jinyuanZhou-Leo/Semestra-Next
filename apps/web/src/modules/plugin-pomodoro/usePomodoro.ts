import {
  pomodoroSessionRecordMutation,
  pomodoroStatsOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useUiPref } from '@/app/ui-pref'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { askNotificationPermission, playChime, showNotification } from './alerts'
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

/** Which timer the status bar follows, and the page it lives on (one at a time). */
export type ActiveTimer = { instanceId: string; path: string }

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

const MODE_LABEL = {
  focus: () => m.pomodoro_mode_focus(),
  short_break: () => m.pomodoro_mode_short_break(),
  long_break: () => m.pomodoro_mode_long_break(),
} as const

export const modeLabel = (mode: keyof typeof MODE_LABEL) => MODE_LABEL[mode]()

/** Focus sessions and focus seconds of today, from the backend (it knows the Program's day). */
export function usePomodoroToday(programId: string) {
  const { data } = useQuery({
    ...pomodoroStatsOptions({ query: { program_id: programId } }),
    staleTime: 30_000,
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
  const [, setActive] = useUiPref<ActiveTimer | null>(ACTIVE_KEY, null)
  const { focus_min, short_break_min, long_break_min, long_break_every, auto_start_next } = settings
  const config = useMemo(
    () => ({ focus_min, short_break_min, long_break_min, long_break_every, auto_start_next }),
    [focus_min, short_break_min, long_break_min, long_break_every, auto_start_next],
  )
  const [now, setNow] = useState(() => Date.now())
  const { mutate: recordSession } = useMutation({
    ...pomodoroSessionRecordMutation(),
    onError: toastError,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: [{ _id: 'pomodoroStats' }] }),
  })

  const latest = useRef({ state, config, settings })
  useEffect(() => {
    latest.current = { state, config, settings }
  })
  const handled = useRef<number | null>(null)

  const here = () => ({ instanceId, path: window.location.pathname + window.location.search })

  useEffect(() => {
    if (state.status !== 'running') return
    const tick = () => {
      const t = Date.now()
      setNow(t)
      const current = latest.current
      if (!isFinished(current.state, t) || handled.current === current.state.endsAt) return
      handled.current = current.state.endsAt
      const done = complete(current.state, t, current.config)
      setState(done.state)
      setActive(
        done.state.status === 'idle' ? null : { instanceId, path: window.location.pathname },
      )
      const endedAt = current.state.endsAt ?? t
      if (done.finished) {
        recordSession({
          body: {
            instance_id: instanceId,
            course_id: current.settings.course_id ?? null,
            started_at: new Date(done.finished.startedAt).toISOString(),
            ended_at: new Date(done.finished.endedAt).toISOString(),
            duration_sec: done.finished.durationSec,
            mode: 'focus',
          },
        })
      }
      if (t - endedAt < STALE_ALERT_MS) {
        if (current.settings.sound) playChime()
        if (current.settings.notify) {
          showNotification(
            current.state.mode === 'focus' ? m.pomodoro_done_focus() : m.pomodoro_done_break(),
            modeLabel(done.state.mode),
          )
        }
      }
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [state.status, state.endsAt, instanceId, setState, setActive, recordSession])

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
      if (settings.notify && state.status === 'idle') askNotificationPermission()
      const t = Date.now()
      setNow(t)
      setState(start(state, t, config))
      setActive(here())
    },
    pause: () => {
      const t = Date.now()
      setNow(t)
      setState(pause(state, t, config))
    },
    skip: () => {
      setState(skip(state, Date.now(), config))
      setActive(null)
    },
    reset: () => {
      setState(reset())
      setActive(null)
    },
  }
}
