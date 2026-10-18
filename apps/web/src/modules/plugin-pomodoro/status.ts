import { Timer } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { StatusItem } from '@/app/extensions'
import { useUiPref } from '@/app/ui-pref'
import { m } from '@/paraglide/messages'
import { ACTIVE_KEY, type ActiveTimer, modeLabel, stateKey } from './usePomodoro'
import { INITIAL_STATE, type TimerState, formatClock } from './timer'

/**
 * The sidebar status line `pomodoro.running` (M14 §3): mode and time left of the timer that was
 * started last, from anywhere in the app; none while no timer is running or paused.
 */
export function usePomodoroStatus(): StatusItem | null {
  const [active] = useUiPref<ActiveTimer | null>(ACTIVE_KEY, null)
  const [state] = useUiPref<TimerState>(stateKey(active?.instanceId ?? 'none'), INITIAL_STATE)
  const [now, setNow] = useState(() => Date.now())
  const running = state.status === 'running'
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

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
