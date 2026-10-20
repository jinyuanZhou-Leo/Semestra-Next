import { Timer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { StatusItem } from '@/app/extensions'
import { useUiPref } from '@/app/ui-pref'
import { m } from '@/paraglide/messages'
import {
  ACTIVE_KEY,
  type ActiveTimer,
  finishPhase,
  modeLabel,
  stateKey,
  useRecordSession,
} from './usePomodoro'
import { INITIAL_STATE, type TimerState, formatClock, isFinished } from './timer'

/**
 * The sidebar status line `pomodoro.running` (M14 §3): mode and time left of the timer that was
 * started last, from anywhere in the app; none while no timer is running or paused.
 */
export function usePomodoroStatus(): StatusItem | null {
  const [active, setActive] = useUiPref<ActiveTimer | null>(ACTIVE_KEY, null)
  const [state, setState] = useUiPref<TimerState>(
    stateKey(active?.instanceId ?? 'none'),
    INITIAL_STATE,
  )
  const { mutate: recordSession } = useRecordSession()
  const [now, setNow] = useState(() => Date.now())
  const running = state.status === 'running'
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  // The status line stays mounted on every page, so it also ends a phase that runs out while the
  // card is not on screen (the card handles it itself when it is; each end is handled once).
  const latest = useRef({ active, state })
  useEffect(() => {
    latest.current = { active, state }
  })
  const watching = running && active?.runtime !== undefined
  useEffect(() => {
    if (!watching || state.endsAt === null) return
    const check = () => {
      const { active: a, state: s } = latest.current
      const t = Date.now()
      if (!a?.runtime || !isFinished(s, t)) return
      finishPhase({
        instanceId: a.instanceId,
        path: a.path,
        state: s,
        now: t,
        runtime: a.runtime,
        active: a,
        setState,
        setActive,
        record: (body) => recordSession({ body }),
      })
    }
    check()
    const timer = window.setInterval(check, 1000)
    return () => window.clearInterval(timer)
  }, [watching, state.endsAt, setState, setActive, recordSession])

  if (!active || state.status === 'idle') return null
  const left =
    running && state.endsAt !== null ? Math.max(0, state.endsAt - now) : (state.remainingMs ?? 0)
  const total = state.phaseMs
  const label = `${modeLabel(state.mode)} ${formatClock(left)}${running ? '' : ` · ${m.pomodoro_paused()}`}`
  return {
    icon: Timer,
    label,
    to: active.path,
    progress: total ? Math.round((1 - left / total) * 100) : undefined,
  }
}
