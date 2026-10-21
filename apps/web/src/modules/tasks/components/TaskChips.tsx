import type { Course, Task, TaskUpdateInputBody } from '@semestra/api-client'
import { CalendarDays, Check, Clock, Clock2, Flag, GraduationCap } from 'lucide-react'
import { useState } from 'react'
import { formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Calendar } from '@/ui/calendar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { TIME_INPUT } from '@/lib/time-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { dueLabel, localDate } from '../due'
import { PRIORITIES, type ShownPriority, shownPriority } from '../types'
import { PRIORITY_NAMES, PriorityMarks } from './priority'

function toIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** A chip: outlined and muted while unset, filled once it has a value. */
function chipClass(set: boolean) {
  return cn('rounded-full font-normal', !set && 'text-muted-foreground')
}

/**
 * The property chips under a task being edited in place (M05 §5.1), like Reminders: due date,
 * time, priority, course and flag. Each change is saved right away.
 */
export function TaskChips({
  task,
  courses,
  today,
  hideCourse,
  onChange,
}: {
  task: Task
  courses: readonly Course[]
  /** The Program's today, for "Today"/"Tomorrow" labels. */
  today: string
  hideCourse?: boolean
  onChange: (body: TaskUpdateInputBody) => void
}) {
  const [dateOpen, setDateOpen] = useState(false)
  const done = task.completed_at !== null
  const shown = shownPriority(task.priority)
  const course = courses.find((c) => c.id === task.course_id)
  // An assessment's task follows it: date, time and course change in the gradebook.
  const managed = task.source_kind === 'assessment'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Popover open={dateOpen} onOpenChange={setDateOpen}>
        <PopoverTrigger
          disabled={managed}
          render={
            <Button
              type="button"
              variant={task.due_date ? 'secondary' : 'outline'}
              size="xs"
              className={cn(
                chipClass(task.due_date !== null),
                task.overdue && !done && 'text-destructive',
              )}
            />
          }
        >
          <CalendarDays aria-hidden />
          {task.due_date
            ? dueLabel({ due_date: task.due_date, due_time: null }, today)
            : m.tasks_chip_date()}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={task.due_date ? localDate(task.due_date) : undefined}
            defaultMonth={task.due_date ? localDate(task.due_date) : undefined}
            onSelect={(date) => {
              if (date) onChange({ due_date: toIso(date) })
              setDateOpen(false)
            }}
          />
          {task.due_date ? (
            <div className="flex justify-end border-t p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange({ due_date: null, due_time: null })
                  setDateOpen(false)
                }}
              >
                {m.tasks_due_clear()}
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      {task.due_date ? <TimeChip task={task} disabled={managed} onChange={onChange} /> : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant={shown === 'none' ? 'outline' : 'secondary'}
              size="xs"
              className={chipClass(shown !== 'none')}
            />
          }
        >
          <PriorityMarks level={shown} placeholder />
          {shown === 'none' ? m.tasks_priority_field() : PRIORITY_NAMES[shown]()}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40">
          <DropdownMenuRadioGroup
            value={shown}
            onValueChange={(value) => {
              const next = value as ShownPriority
              // Picking the level already shown keeps an `urgent` task as it is.
              if (next !== shown) onChange({ priority: next })
            }}
          >
            {PRIORITIES.map((p) => (
              <DropdownMenuRadioItem key={p} value={p}>
                <PriorityMarks level={p} />
                {PRIORITY_NAMES[p]()}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {hideCourse ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={managed}
            render={
              <Button
                type="button"
                variant={course ? 'secondary' : 'outline'}
                size="xs"
                className={cn(chipClass(course !== undefined), 'max-w-48')}
              />
            }
          >
            {course ? (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: courseColor(course) }}
              />
            ) : (
              <GraduationCap aria-hidden />
            )}
            <span className="truncate">
              {course ? courseLabel(course) : m.tasks_course_label()}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => onChange({ course_id: null })}>
                {m.tasks_course_none()}
                {task.course_id === null ? <Check aria-hidden className="ml-auto" /> : null}
              </DropdownMenuItem>
              {courses.map((c) => (
                <DropdownMenuItem key={c.id} onClick={() => onChange({ course_id: c.id })}>
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: courseColor(c) }}
                  />
                  <span className="truncate">{courseLabel(c)}</span>
                  {task.course_id === c.id ? <Check aria-hidden className="ml-auto" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button
        type="button"
        variant={task.flagged ? 'secondary' : 'outline'}
        size="xs"
        aria-pressed={task.flagged}
        className={chipClass(task.flagged)}
        onClick={() => onChange({ flagged: !task.flagged })}
      >
        <Flag aria-hidden className={cn(task.flagged && 'fill-current text-primary')} />
        {task.flagged ? m.tasks_flagged() : m.tasks_flag()}
      </Button>
    </div>
  )
}

/** The time chip; a click turns it into a time field, saved on Enter or leaving it. */
function TimeChip({
  task,
  disabled,
  onChange,
}: {
  task: Task
  disabled: boolean
  onChange: (body: TaskUpdateInputBody) => void
}) {
  const current = task.due_time?.slice(0, 5) ?? ''
  const [draft, setDraft] = useState<string | null>(null)
  if (draft !== null) {
    const finish = (save: boolean) => {
      setDraft(null)
      if (save && draft !== current) onChange({ due_time: draft || null })
    }
    return (
      <InputGroup className="h-6 w-28">
        <InputGroupInput
          type="time"
          ref={(el) => {
            if (el && document.activeElement !== el) el.focus()
          }}
          aria-label={m.tasks_due_time_label()}
          className={cn(TIME_INPUT, 'text-xs')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              finish(true)
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              finish(false)
            }
          }}
        />
        <InputGroupAddon>
          <Clock2 aria-hidden />
        </InputGroupAddon>
      </InputGroup>
    )
  }
  return (
    <Button
      type="button"
      variant={current ? 'secondary' : 'outline'}
      size="xs"
      className={chipClass(current !== '')}
      disabled={disabled}
      onClick={() => setDraft(current)}
    >
      <Clock aria-hidden />
      {current ? formatTime(`${task.due_date}T${current}`) : m.tasks_due_time_label()}
    </Button>
  )
}
