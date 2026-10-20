import type { Course, Task, TaskList } from '@semestra/api-client'
import { CalendarDays, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useHotkey } from '@/app/hotkeys'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { HistoryLink } from '@/components/HistoryLink'
import { formatDate } from '@/lib/format'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { coursePath } from '@/modules/academics/paths'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Calendar } from '@/ui/calendar'
import { Field, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/sheet'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Switch } from '@/ui/switch'
import { Textarea } from '@/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import type { TaskActions } from '../actions'
import { PRIORITIES, type Priority, type ShownPriority, shownPriority } from '../types'
import { PRIORITY_NAMES, PriorityMarks } from './priority'

type Draft = {
  title: string
  notes: string
  due_date: string | null
  due_time: string | null
  priority: Priority
  flagged: boolean
  list_id: string | null
  course_id: string | null
}

function draftOf(task: Task): Draft {
  return {
    title: task.title,
    notes: task.notes,
    due_date: task.due_date,
    due_time: task.due_time?.slice(0, 5) ?? null,
    priority: task.priority,
    flagged: task.flagged,
    list_id: task.list_id,
    course_id: task.course_id,
  }
}

function toDate(iso: string): Date {
  const [y, mo, d] = iso.split('-').map(Number)
  return new Date(y!, (mo ?? 1) - 1, d ?? 1)
}

function toIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * The side panel of a task, opened from the row's ⋯ menu (M05 §5.1). Changes are collected and
 * saved together with the Save button or Cmd/Ctrl+Enter, which also closes the panel; mount it
 * with `key={task.id}` so another task starts fresh.
 */
export function TaskDetail({
  task,
  lists,
  courses,
  actions,
  onClose,
}: {
  task: Task
  lists: readonly TaskList[]
  courses: readonly Course[]
  actions: TaskActions
  onClose: () => void
}) {
  const [draft, setDraft] = useState(() => draftOf(task))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const base = draftOf(task)
  const dirty = (Object.keys(base) as (keyof Draft)[]).some((key) => base[key] !== draft[key])
  const valid = draft.title.trim().length > 0
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const save = async () => {
    if (!dirty || !valid || saving) return
    setSaving(true)
    const body: Record<string, unknown> = {}
    for (const key of Object.keys(base) as (keyof Draft)[]) {
      if (base[key] !== draft[key]) body[key] = key === 'title' ? draft.title.trim() : draft[key]
    }
    if (draft.due_date === null) delete body.due_time
    const saved = await actions.update(task.id, body).then(
      () => true,
      () => false,
    )
    setSaving(false)
    // Saving finishes the edit; on failure the panel stays open with the changes (the error toasts).
    if (saved) onClose()
  }
  useHotkey('mod+enter', () => void save(), { allowInInputs: true })

  const source = task.source_kind && task.source_kind !== 'manual' ? task.source_kind : null
  // An assessment's task follows it: its title, due date and course change in the gradebook.
  const managed = task.source_kind === 'assessment'
  const listName = (list: TaskList) => list.name
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{m.tasks_details()}</SheetTitle>
          <SheetDescription className="sr-only">{task.title}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4 pt-0">
          <Input
            aria-label={m.tasks_title_label()}
            className="h-9 text-base font-medium"
            value={draft.title}
            maxLength={300}
            aria-invalid={!valid}
            readOnly={managed}
            onChange={(event) => set('title', event.target.value)}
          />
          <Field>
            <FieldLabel htmlFor="task-notes">{m.tasks_notes_label()}</FieldLabel>
            <Textarea
              id="task-notes"
              rows={5}
              maxLength={20000}
              placeholder={m.tasks_notes_placeholder()}
              value={draft.notes}
              onChange={(event) => set('notes', event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>{m.tasks_due_label()}</FieldLabel>
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger
                  disabled={managed}
                  render={<Button variant="outline" className="flex-1 justify-start font-normal" />}
                >
                  <CalendarDays aria-hidden />
                  {draft.due_date ? formatDate(toDate(draft.due_date)) : m.tasks_due_none()}
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={draft.due_date ? toDate(draft.due_date) : undefined}
                    defaultMonth={draft.due_date ? toDate(draft.due_date) : undefined}
                    onSelect={(date) => set('due_date', date ? toIso(date) : null)}
                  />
                </PopoverContent>
              </Popover>
              <Input
                type="time"
                aria-label={m.tasks_due_time_label()}
                className="w-28"
                disabled={managed || !draft.due_date}
                value={draft.due_time ?? ''}
                onChange={(event) => set('due_time', event.target.value || null)}
              />
              {draft.due_date && !managed ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={m.tasks_due_clear()}
                        onClick={() => setDraft((c) => ({ ...c, due_date: null, due_time: null }))}
                      />
                    }
                  >
                    <X aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent>{m.tasks_due_clear()}</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </Field>
          <Field>
            <FieldLabel>{m.tasks_priority_field()}</FieldLabel>
            <ToggleGroup
              variant="outline"
              className="w-full"
              aria-label={m.tasks_priority_field()}
              value={[shownPriority(draft.priority)]}
              onValueChange={(value) => {
                const next = value[0] as ShownPriority | undefined
                // Picking the level already shown keeps an `urgent` task as it is.
                if (next && next !== shownPriority(draft.priority)) set('priority', next)
              }}
            >
              {PRIORITIES.map((p) => (
                <ToggleGroupItem key={p} value={p} className="flex-1 gap-1 px-1 text-xs">
                  {p === 'none' ? null : <PriorityMarks level={p} className="min-w-0" />}
                  {p === 'none' ? m.tasks_priority_none_short() : PRIORITY_NAMES[p]()}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="task-flag">{m.tasks_flag()}</FieldLabel>
            <Switch
              id="task-flag"
              checked={draft.flagged}
              onCheckedChange={(checked) => set('flagged', checked)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="task-list">{m.tasks_list_label()}</FieldLabel>
            <Select
              value={draft.list_id}
              onValueChange={(value) => set('list_id', value)}
              items={[
                { value: null, label: m.tasks_view_inbox() },
                ...lists.map((l) => ({ value: l.id, label: listName(l) })),
              ]}
            >
              <SelectTrigger id="task-list" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={null}>{m.tasks_view_inbox()}</SelectItem>
                  {lists.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {listName(l)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="task-course">{m.tasks_course_label()}</FieldLabel>
            <Select
              value={draft.course_id}
              disabled={managed}
              onValueChange={(value) => set('course_id', value)}
              items={[
                { value: null, label: m.tasks_course_none() },
                ...courses.map((c) => ({ value: c.id, label: courseLabel(c) })),
              ]}
            >
              <SelectTrigger id="task-course" className="w-full">
                <SelectValue>
                  {(value: string | null) => {
                    const selected = courses.find((c) => c.id === value)
                    return selected ? <CourseOption course={selected} /> : m.tasks_course_none()
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={null}>{m.tasks_course_none()}</SelectItem>
                  {courses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <CourseOption course={c} />
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {managed ? (
            <p className="text-xs text-muted-foreground">
              {m.tasks_managed_note()}{' '}
              {task.course_id ? (
                <HistoryLink
                  href={coursePath(task.program_id, task.course_id, 'grades')}
                  onClick={onClose}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {m.tasks_managed_open()}
                </HistoryLink>
              ) : null}
            </p>
          ) : source ? (
            <p className="text-xs text-muted-foreground">
              {m.tasks_source({ source: SOURCE_NAMES[source]?.() ?? source })}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden />
              {m.common_delete()}
            </Button>
            <Button disabled={!dirty || !valid || saving} onClick={() => void save()}>
              {m.common_save()}
            </Button>
          </div>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title={m.tasks_delete_title()}
            description={m.tasks_delete_description({ title: task.title })}
            confirmLabel={m.common_delete()}
            onConfirm={() => {
              setConfirmDelete(false)
              onClose()
              void actions.remove(task.id)
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** A course with its color dot, centered on the text in the list and in the field. */
function CourseOption({ course }: { course: Course }) {
  return (
    <>
      <span
        aria-hidden
        className="size-2 shrink-0 self-center rounded-full"
        style={{ backgroundColor: courseColor(course) }}
      />
      <span className="truncate">{courseLabel(course)}</span>
    </>
  )
}

const SOURCE_NAMES: Record<string, () => string> = {
  assessment: m.tasks_source_assessment,
  lms: m.tasks_source_lms,
  syllabus: m.tasks_source_syllabus,
  agent: m.tasks_source_agent,
}
