import type { OneOffEvent } from '@semestra/api-client'
import {
  scheduleEventCreateMutation,
  scheduleEventDeleteMutation,
  scheduleEventUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { courseLabel } from '@/modules/academics/color'
import { useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { Textarea } from '@/ui/textarea'
import { typeName } from '../labels'
import { invalidateSchedule, useEventTypes } from '../queries'
import { plusDays, toWall } from '../time'
import { Field, SimpleSelect } from './Field'

const NONE = '__none__'

/** A new event's times as Program wall-clock strings (`yyyy-MM-ddTHH:mm`). */
export type EventSlot = { start: string; end: string; allDay: boolean }

type Draft = {
  title: string
  course_id: string
  type_code: string
  all_day: boolean
  start: string
  end: string
  location: string
  note: string
}

function draftOf(event: OneOffEvent | undefined, slot: EventSlot | undefined, tz: string, courseId?: string): Draft {
  if (event) {
    const start = toWall(event.start_at, tz).slice(0, 16)
    const end = toWall(event.end_at, tz).slice(0, 16)
    return {
      title: event.title,
      course_id: event.course_id ?? NONE,
      type_code: event.type_code ?? NONE,
      all_day: event.all_day,
      start,
      // All-day events end at the midnight after their last day.
      end: event.all_day ? `${plusDays(end.slice(0, 10), -1)}T00:00` : end,
      location: event.location ?? '',
      note: event.note ?? '',
    }
  }
  return {
    title: '',
    course_id: courseId ?? NONE,
    type_code: NONE,
    all_day: slot?.allDay ?? false,
    start: slot?.start ?? '',
    end: slot?.end ?? '',
    location: '',
    note: '',
  }
}

/**
 * Add or edit a one-off event such as an exam or office hours (M04 §2). Times are entered in the
 * Program's time zone; the API reads times without an offset the same way.
 */
export function EventDialog({
  programId,
  timezone,
  termId,
  courseId,
  event,
  slot,
  open,
  onOpenChange,
}: {
  programId: string
  timezone: string
  /** The term the event is created in (the calendar's term), if any. */
  termId?: string
  /** Preselected course (a course page). */
  courseId?: string
  event?: OneOffEvent
  slot?: EventSlot
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const types = useEventTypes(programId).data?.items ?? []
  const courses = useCourses(programId, termId).data?.items ?? []
  const [draft, setDraft] = useState<Draft>(() => draftOf(event, slot, timezone, courseId))
  const [touched, setTouched] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const done = async () => {
    await invalidateSchedule(queryClient)
    onOpenChange(false)
  }
  const create = useMutation({ ...scheduleEventCreateMutation(), onError: toastError, onSuccess: done })
  const update = useMutation({ ...scheduleEventUpdateMutation(), onError: toastError, onSuccess: done })
  const remove = useMutation({
    ...scheduleEventDeleteMutation(),
    onError: toastError,
    onSuccess: async () => {
      setDeleting(false)
      await done()
    },
  })
  const pending = create.isPending || update.isPending

  const startDay = draft.start.slice(0, 10)
  const endDay = draft.end.slice(0, 10)
  const start = draft.all_day ? `${startDay}T00:00` : draft.start
  const end = draft.all_day ? `${endDay || startDay}T00:00` : draft.end || draft.start
  const titleMissing = draft.title.trim() === ''
  const timeMissing = startDay === ''
  const timeInvalid = !timeMissing && end < start

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (titleMissing || timeMissing || timeInvalid) return
    const course = courses.find((c) => c.id === draft.course_id)
    const body = {
      title: draft.title.trim(),
      start_at: start,
      end_at: end,
      all_day: draft.all_day,
      course_id: course?.id ?? null,
      term_id: termId && (!course || course.term_ids.includes(termId)) ? termId : null,
      type_code: draft.type_code === NONE ? null : draft.type_code,
      location: draft.location.trim() || null,
      note: draft.note.trim() || null,
    }
    if (event) update.mutate({ path: { event_id: event.id }, body })
    else create.mutate({ path: { program_id: programId }, body })
  }

  const dateType = draft.all_day ? 'date' : 'datetime-local'
  const dateValue = (value: string) => (draft.all_day ? value.slice(0, 10) : value)
  const fromInput = (value: string, previous: string) =>
    draft.all_day ? `${value}T${previous.slice(11, 16) || '00:00'}` : value

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent closeLabel={m.common_close()} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{event ? m.schedule_event_edit() : m.schedule_event_add()}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="grid grid-cols-2 gap-4">
          <Field
            label={m.schedule_event_title()}
            className="col-span-2"
            error={touched && titleMissing ? m.schedule_required() : null}
          >
            <Input
              placeholder={m.schedule_event_title_placeholder()}
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>
          <Field label={m.schedule_course()}>
            <SimpleSelect
              value={draft.course_id}
              onChange={(v) => set('course_id', v)}
              options={[
                { value: NONE, label: m.schedule_no_course() },
                ...courses.map((c) => ({ value: c.id, label: courseLabel(c) })),
              ]}
            />
          </Field>
          <Field label={m.schedule_type()}>
            <SimpleSelect
              value={draft.type_code}
              onChange={(v) => set('type_code', v)}
              options={[
                { value: NONE, label: m.schedule_no_type() },
                ...types.map((t) => ({ value: t.code, label: `${t.code} · ${typeName(t)}` })),
              ]}
            />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <Checkbox checked={draft.all_day} onCheckedChange={(on) => set('all_day', on)} />
            {m.schedule_all_day()}
          </label>
          <Field
            label={m.schedule_starts()}
            error={touched && timeMissing ? m.schedule_required() : null}
          >
            <Input
              type={dateType}
              value={dateValue(draft.start)}
              onChange={(e) => set('start', fromInput(e.target.value, draft.start))}
            />
          </Field>
          <Field
            label={m.schedule_ends()}
            error={touched && timeInvalid ? m.error_schedule_time_range_invalid() : null}
          >
            <Input
              type={dateType}
              value={dateValue(draft.end)}
              onChange={(e) => set('end', fromInput(e.target.value, draft.end))}
            />
          </Field>
          <Field label={m.schedule_location()} className="col-span-2">
            <Input value={draft.location} onChange={(e) => set('location', e.target.value)} />
          </Field>
          <Field label={m.schedule_note()} className="col-span-2">
            <Textarea rows={2} value={draft.note} onChange={(e) => set('note', e.target.value)} />
          </Field>
          <DialogFooter className="col-span-2">
            {event ? (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-destructive"
                onClick={() => setDeleting(true)}
              >
                {m.schedule_event_delete()}
              </Button>
            ) : null}
            <Button type="submit" disabled={pending}>
              {pending ? m.common_saving() : m.common_save()}
            </Button>
          </DialogFooter>
        </form>
        {event ? (
          <ConfirmDialog
            open={deleting}
            onOpenChange={setDeleting}
            title={m.schedule_event_delete_title()}
            description={m.schedule_event_delete_description()}
            confirmLabel={m.schedule_event_delete()}
            pending={remove.isPending}
            onConfirm={() => remove.mutate({ path: { event_id: event.id } })}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
