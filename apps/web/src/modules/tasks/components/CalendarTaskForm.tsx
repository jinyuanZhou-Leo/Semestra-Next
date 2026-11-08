import { type FormEvent, useId, useState } from 'react'
import type { CalendarCreateProps } from '@/app/extensions'
import { useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { DialogFooter } from '@/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { Textarea } from '@/ui/textarea'
import { useTaskActions } from '../actions'
import { newTaskBody, type NewTaskPlace } from '../new-task'
import { useProgramToday, useTaskSettings } from '../queries'
import { type ChipValues, TaskChips } from './TaskChips'

/** "New → To-do" in the calendar: a task due on the slot picked (M04 §5.2, M05 §4). */
export default function CalendarTaskForm({
  programId,
  termId,
  start,
  allDay,
  onDone,
  onCancel,
}: CalendarCreateProps) {
  const fid = useId()
  const today = useProgramToday(programId)
  const settings = useTaskSettings(programId)
  const courses = useCourses(programId, termId).data?.items ?? []
  const { actions, pending } = useTaskActions()
  const [place] = useState<NewTaskPlace>(() => ({
    initial: {
      due_date: start.slice(0, 10),
      due_time: allDay ? null : start.slice(11, 16),
      priority: settings.default_priority,
      course_id: null,
      flagged: false,
    },
    termId,
  }))
  const [values, setValues] = useState<ChipValues>(place.initial)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState(false)
  const titleMissing = title.trim() === ''

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (titleMissing) return
    await actions.create(programId, newTaskBody(place, { title: title.trim(), notes, values }))
    onDone()
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e).catch(() => undefined)} className="grid gap-4">
      <Field data-invalid={(touched && titleMissing) || undefined}>
        <FieldLabel htmlFor={`${fid}-title`}>{m.tasks_title_label()}</FieldLabel>
        <Input
          id={`${fid}-title`}
          aria-invalid={(touched && titleMissing) || undefined}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {touched && titleMissing ? <FieldError>{m.common_required()}</FieldError> : null}
      </Field>
      <TaskChips
        task={values}
        courses={courses}
        today={today}
        overdue={values.due_date !== null && values.due_date < today}
        onChange={(body) => setValues((current) => ({ ...current, ...body }) as ChipValues)}
      />
      <Field>
        <FieldLabel htmlFor={`${fid}-notes`}>{m.tasks_notes_label()}</FieldLabel>
        <Textarea
          id={`${fid}-notes`}
          rows={2}
          placeholder={m.tasks_notes_placeholder()}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          {m.common_cancel()}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? m.common_saving() : m.common_save()}
        </Button>
      </DialogFooter>
    </form>
  )
}
