import type { Course, Task, TaskList, TaskUpdateInputBody } from '@semestra/api-client'
import { Clock2, Flag, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { TIME_INPUT } from '@/lib/time-input'
import { courseLabel } from '@/modules/academics/color'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/ui/drawer'
import { Field, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { Label } from '@/ui/label'
import { NativeSelect, NativeSelectOption } from '@/ui/native-select'
import { Switch } from '@/ui/switch'
import { Textarea } from '@/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import type { TaskActions } from '../actions'
import { PRIORITY_NAMES } from '../components/priority'
import { PRIORITIES, type ShownPriority, shownPriority } from '../types'

const NONE = ''

/**
 * A task's details on a phone (M17), in a drawer from the bottom. Each change is saved as it is
 * made, like the desktop's chips; the title and notes when they lose focus.
 */
export function TaskSheet({
  task,
  courses,
  lists,
  actions,
  open,
  onClose,
}: {
  task: Task
  courses: readonly Course[]
  lists: readonly TaskList[]
  actions: TaskActions
  open: boolean
  onClose: () => void
}) {
  // What the drawer shows: the task as opened, with the changes made in it.
  const [draft, setDraft] = useState(task)
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const [deleting, setDeleting] = useState(false)
  // An assessment's task follows it: title, date and course change in the gradebook.
  const managed = task.source_kind === 'assessment'
  const done = draft.completed_at !== null
  const save = (body: TaskUpdateInputBody) => {
    setDraft((current) => ({ ...current, ...body }) as Task)
    void actions.update(task.id, body)
  }
  const saveTitle = () => {
    const next = title.trim()
    if (next && next !== draft.title) save({ title: next })
    else setTitle(draft.title)
  }
  return (
    <>
      <Drawer open={open} onOpenChange={(next) => !next && onClose()} showSwipeHandle>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="sr-only">{m.tasks_details()}</DrawerTitle>
          </DrawerHeader>
          <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="task-sheet-title">{m.tasks_title_label()}</FieldLabel>
                <Input
                  id="task-sheet-title"
                  value={title}
                  maxLength={400}
                  disabled={managed}
                  onChange={(event) => setTitle(event.target.value)}
                  onBlur={saveTitle}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="task-sheet-due">{m.tasks_due_label()}</FieldLabel>
                  <Input
                    id="task-sheet-due"
                    type="date"
                    value={draft.due_date ?? ''}
                    disabled={managed}
                    onChange={(event) => {
                      const due = event.target.value || null
                      save({ due_date: due, due_time: due ? draft.due_time : null })
                    }}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="task-sheet-time">{m.tasks_due_time_label()}</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="task-sheet-time"
                      type="time"
                      className={TIME_INPUT}
                      value={draft.due_time?.slice(0, 5) ?? ''}
                      disabled={managed || !draft.due_date}
                      onChange={(event) => save({ due_time: event.target.value || null })}
                    />
                    <InputGroupAddon>
                      <Clock2 aria-hidden />
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="task-sheet-course">{m.tasks_course_label()}</FieldLabel>
                <NativeSelect
                  id="task-sheet-course"
                  value={draft.course_id ?? NONE}
                  disabled={managed}
                  onChange={(event) => save({ course_id: event.target.value || null })}
                >
                  <NativeSelectOption value={NONE}>{m.tasks_course_none()}</NativeSelectOption>
                  {courses.map((course) => (
                    <NativeSelectOption key={course.id} value={course.id}>
                      {courseLabel(course)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel>{m.tasks_priority_field()}</FieldLabel>
                <ToggleGroup
                  className={`${SEGMENTED} w-full`}
                  value={[shownPriority(draft.priority)]}
                  onValueChange={(value) =>
                    value[0] && save({ priority: value[0] as ShownPriority })
                  }
                >
                  {PRIORITIES.map((level) => (
                    <ToggleGroupItem key={level} value={level} className={`${SEGMENT} flex-1`}>
                      {level === 'none' ? m.tasks_priority_none_short() : PRIORITY_NAMES[level]()}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
              <Field>
                <FieldLabel htmlFor="task-sheet-list">{m.tasks_list_label()}</FieldLabel>
                <NativeSelect
                  id="task-sheet-list"
                  value={draft.list_id ?? NONE}
                  onChange={(event) => {
                    const listId = event.target.value || null
                    setDraft((current) => ({ ...current, list_id: listId }))
                    void actions.move(task.id, { list_id: listId })
                  }}
                >
                  <NativeSelectOption value={NONE}>{m.tasks_view_inbox()}</NativeSelectOption>
                  {lists.map((list) => (
                    <NativeSelectOption key={list.id} value={list.id}>
                      {list.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field orientation="horizontal">
                <Flag aria-hidden className="size-4 text-muted-foreground" />
                <Label htmlFor="task-sheet-flag" className="flex-1">
                  {m.tasks_flag()}
                </Label>
                <Switch
                  id="task-sheet-flag"
                  checked={draft.flagged}
                  onCheckedChange={(flagged) => save({ flagged })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="task-sheet-notes">{m.tasks_notes_label()}</FieldLabel>
                <Textarea
                  id="task-sheet-notes"
                  value={notes}
                  placeholder={m.tasks_notes_placeholder()}
                  onChange={(event) => setNotes(event.target.value)}
                  onBlur={() => notes !== draft.notes && save({ notes })}
                />
              </Field>
            </FieldGroup>
            {managed ? (
              <p className="text-xs text-muted-foreground">{m.tasks_managed_note()}</p>
            ) : null}
            <div className="flex gap-2">
              <Button
                className="h-11 flex-1"
                variant={done ? 'outline' : 'default'}
                onClick={() => {
                  void actions.complete(task.id, !done)
                  onClose()
                }}
              >
                {done ? m.mobile_task_reopen() : m.mobile_task_complete()}
              </Button>
              <Button
                variant="destructive"
                size="icon"
                className="size-11"
                aria-label={m.mobile_task_delete()}
                onClick={() => setDeleting(true)}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={m.tasks_delete_title()}
        description={m.tasks_delete_description({ title: draft.title })}
        confirmLabel={m.mobile_task_delete()}
        onConfirm={() => {
          setDeleting(false)
          onClose()
          void actions.remove(task.id)
        }}
      />
    </>
  )
}
