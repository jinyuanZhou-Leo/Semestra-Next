import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react'
import type { CardProps } from '@/app/extensions'
import { courseLabel } from '@/modules/academics/color'
import { useCourses } from '@/modules/academics/queries'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Ring } from '../plugin-kit/Ring'
import { useCardSettings } from '../plugin-kit/useCardSettings'
import { formatSpan } from '../plugin-kit/duration'
import type { PomodoroSettings } from './schema'
import { formatClock, progressAt } from './timer'
import { modeLabel, usePomodoro, usePomodoroToday } from './usePomodoro'

const NO_COURSE = '__none__'

function CourseSelect({
  programId,
  value,
  onChange,
}: {
  programId: string
  value: string | undefined
  onChange: (courseId: string | undefined) => void
}) {
  const courses = useCourses(programId).data?.items ?? []
  const items = [
    { value: NO_COURSE, label: m.pomodoro_no_course() },
    ...courses.map((c) => ({ value: c.id, label: courseLabel(c) })),
  ]
  return (
    <Select
      value={value ?? NO_COURSE}
      items={items}
      onValueChange={(next) => onChange(next === NO_COURSE || !next ? undefined : String(next))}
    >
      <SelectTrigger aria-label={m.pomodoro_course()} className="w-full min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/** Pomodoro timer card (M14 §3): focus and break phases, today's count, optional course. */
export default function PomodoroCard({
  scope,
  instanceId,
  size,
  settings,
}: CardProps<PomodoroSettings>) {
  const { value: current, update } = useCardSettings(instanceId, settings, 300)
  const timer = usePomodoro(instanceId, scope.programId, current)
  const today = usePomodoroToday(scope.programId)
  const { state, remaining } = timer
  const running = state.status === 'running'
  const ratio = progressAt(state, timer.now, timer.config)
  const clock = formatClock(remaining)

  const controls = (
    <div className="flex items-center gap-1.5">
      <Button
        size="icon"
        aria-label={running ? m.pomodoro_pause() : m.pomodoro_start()}
        onClick={running ? timer.pause : timer.start}
      >
        {running ? <Pause aria-hidden /> : <Play aria-hidden />}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={m.pomodoro_skip()} onClick={timer.skip}>
        <SkipForward aria-hidden />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={m.pomodoro_reset()} onClick={timer.reset}>
        <RotateCcw aria-hidden />
      </Button>
    </div>
  )

  const phaseColor = state.mode === 'focus' ? 'var(--primary)' : 'var(--success)'
  const dots = Array.from({ length: current.long_break_every }, (_, i) => i < state.cycleIndex)

  if (size === 's') {
    return (
      <div className="flex h-full flex-col items-center justify-between gap-1">
        <p className="text-xs text-muted-foreground">{modeLabel(state.mode)}</p>
        <output
          aria-label={`${modeLabel(state.mode)} ${clock}`}
          className="font-heading text-4xl font-semibold tabular-nums"
        >
          {clock}
        </output>
        {controls}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex min-h-0 flex-1 items-center gap-4">
        <Ring ratio={ratio} color={phaseColor} className="h-full max-h-32" strokeWidth={7}>
          <output
            aria-label={`${modeLabel(state.mode)} ${clock}`}
            className={cn(
              'font-heading font-semibold tabular-nums',
              size === 'm' ? 'text-2xl' : 'text-4xl',
            )}
          >
            {clock}
          </output>
        </Ring>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium">{modeLabel(state.mode)}</p>
          <div className="flex gap-1" aria-hidden>
            {dots.map((filled, i) => (
              <span
                key={i}
                className={cn('size-1.5 rounded-full', filled ? 'bg-primary' : 'bg-muted')}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {m.pomodoro_today_count({ count: today.sessions })}
            {size === 'l' ? ` · ${formatSpan(today.focusSec)}` : ''}
          </p>
          {controls}
        </div>
      </div>
      {size === 'l' ? (
        <CourseSelect
          programId={scope.programId}
          value={current.course_id}
          onChange={(course_id) => update({ course_id })}
        />
      ) : null}
    </div>
  )
}
