import type { OneOffEvent } from '@semestra/api-client'
import {
  scheduleEventCreateMutation,
  scheduleEventDeleteMutation,
  scheduleEventUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarIcon, Clock2 } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { calendarLocale } from '@/lib/calendar'
import { formatDate } from '@/lib/format'
import { toastError } from '@/lib/errors'
import { courseLabel } from '@/modules/academics/color'
import { useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Calendar } from '@/ui/calendar'
import { Checkbox } from '@/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { TIME_INPUT } from '@/lib/time-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Textarea } from '@/ui/textarea'
import { typeName } from '../labels'
import { invalidateSchedule, useEventTypes } from '../queries'
import { isoDay } from '@/lib/day'
import { localDay, plusDays, toWall } from '../time'

function calendarDay(value: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''
}

function clock(value: string): string {
  return value.match(/T(\d{2}:\d{2})/)?.[1] ?? ''
}

function withDay(value: string, day: string): string {
  return `${day}T${clock(value) || '00:00'}`
}

function withClock(value: string, time: string): string {
  const day = calendarDay(value)
  if (!day) return time ? `T${time}` : ''
  return `${day}T${time || '00:00'}`
}

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

function draftOf(
  event: OneOffEvent | undefined,
  slot: EventSlot | undefined,
  tz: string,
  courseId?: string,
): Draft {
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
  const fid = useId()
  const queryClient = useQueryClient()
  const types = useEventTypes(programId).data?.items ?? []
  // An existing event may belong to a course outside this term, so editing lists them all.
  const courses = useCourses(programId, event ? undefined : termId).data?.items ?? []
  const [draft, setDraft] = useState<Draft>(() => draftOf(event, slot, timezone, courseId))
  const [touched, setTouched] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [startOpen, setStartOpen] = useState(false)
  const [endOpen, setEndOpen] = useState(false)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const done = async () => {
    await invalidateSchedule(queryClient)
    onOpenChange(false)
  }
  const create = useMutation({
    ...scheduleEventCreateMutation(),
    onError: toastError,
    onSuccess: done,
  })
  const update = useMutation({
    ...scheduleEventUpdateMutation(),
    onError: toastError,
    onSuccess: done,
  })
  const remove = useMutation({
    ...scheduleEventDeleteMutation(),
    onError: toastError,
    onSuccess: async () => {
      setDeleting(false)
      await done()
    },
  })
  const pending = create.isPending || update.isPending

  const startDay = calendarDay(draft.start)
  const endDay = calendarDay(draft.end)
  const start = draft.all_day ? `${startDay}T00:00` : draft.start
  // The form shows an all-day event's last day; the API takes the midnight after it.
  const end = draft.all_day ? `${plusDays(endDay || startDay, 1)}T00:00` : draft.end || draft.start
  const titleMissing = draft.title.trim() === ''
  const timeMissing = startDay === ''
  // All-day: compare the days shown, before the end becomes the midnight after the last one.
  const timeInvalid =
    !timeMissing && (draft.all_day ? (endDay || startDay) < startDay : end < start)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (titleMissing || timeMissing || timeInvalid) return
    const pickedCourse = draft.course_id === NONE ? null : draft.course_id
    // The list may still be loading: the course is kept either way, only the term check waits.
    const course = courses.find((c) => c.id === pickedCourse)
    // Editing keeps the event's own term; a new event belongs to the calendar's term.
    const term = event ? event.term_id : termId
    const body = {
      title: draft.title.trim(),
      start_at: start,
      end_at: end,
      all_day: draft.all_day,
      course_id: pickedCourse,
      term_id: term && (!course || course.term_ids.includes(term)) ? term : null,
      type_code: draft.type_code === NONE ? null : draft.type_code,
      location: draft.location.trim() || null,
      note: draft.note.trim() || null,
    }
    if (event) update.mutate({ path: { event_id: event.id }, body })
    else create.mutate({ path: { program_id: programId }, body })
  }

  const courseItems = [
    { value: NONE, label: m.schedule_no_course() },
    ...courses.map((c) => ({ value: c.id, label: courseLabel(c) })),
  ]
  const typeItems = [
    { value: NONE, label: m.schedule_no_type() },
    ...types.map((t) => ({ value: t.code, label: `${t.code} · ${typeName(t)}` })),
  ]
  const calendar = calendarLocale()
  const startSelected = startDay ? localDay(startDay) : undefined
  const endSelected = endDay ? localDay(endDay) : undefined

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{event ? m.schedule_event_edit() : m.schedule_event_add()}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="grid grid-cols-2 gap-4">
          <Field className="col-span-2" data-invalid={(touched && titleMissing) || undefined}>
            <FieldLabel htmlFor={`${fid}-1`}>{m.schedule_event_title()}</FieldLabel>
            <Input
              id={`${fid}-1`}
              aria-invalid={(touched && titleMissing) || undefined}
              placeholder={m.schedule_event_title_placeholder()}
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
            />
            {touched && titleMissing ? <FieldError>{m.schedule_required()}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fid}-2`}>{m.schedule_course()}</FieldLabel>
            <Select
              value={draft.course_id}
              items={courseItems}
              onValueChange={(next) => next && set('course_id', next)}
            >
              <SelectTrigger id={`${fid}-2`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {courseItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fid}-3`}>{m.schedule_type()}</FieldLabel>
            <Select
              value={draft.type_code}
              items={typeItems}
              onValueChange={(next) => next && set('type_code', next)}
            >
              <SelectTrigger id={`${fid}-3`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {typeItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field orientation="horizontal" className="col-span-2 w-auto">
            <Checkbox
              id={`${fid}-all-day`}
              checked={draft.all_day}
              onCheckedChange={(on) => set('all_day', on)}
            />
            <FieldLabel htmlFor={`${fid}-all-day`} className="font-normal">
              {m.schedule_all_day()}
            </FieldLabel>
          </Field>
          <Field className="col-span-2" data-invalid={(touched && timeMissing) || undefined}>
            <FieldLabel htmlFor={`${fid}-4`}>{m.schedule_starts()}</FieldLabel>
            <div className="flex gap-2">
              <Popover open={startOpen} onOpenChange={setStartOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      id={`${fid}-4`}
                      type="button"
                      variant="outline"
                      aria-invalid={(touched && timeMissing) || undefined}
                      data-empty={!startSelected}
                      className="w-full min-w-0 flex-1 justify-start text-left font-normal data-[empty=true]:text-muted-foreground"
                    />
                  }
                >
                  <CalendarIcon data-icon="inline-start" />
                  {startSelected ? formatDate(startDay) : m.schedule_date_placeholder()}
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={startSelected}
                    defaultMonth={startSelected}
                    {...calendar}
                    onSelect={(next) => {
                      const day = next ? isoDay(next) : ''
                      set(
                        'start',
                        day ? withDay(draft.start, day) : withClock('', clock(draft.start)),
                      )
                      setStartOpen(false)
                    }}
                  />
                </PopoverContent>
              </Popover>
              {draft.all_day ? null : (
                <InputGroup className="w-32 shrink-0">
                  <InputGroupInput
                    type="time"
                    aria-label={m.schedule_start_time()}
                    className={TIME_INPUT}
                    value={clock(draft.start)}
                    onChange={(input) => set('start', withClock(draft.start, input.target.value))}
                  />
                  <InputGroupAddon>
                    <Clock2 aria-hidden />
                  </InputGroupAddon>
                </InputGroup>
              )}
            </div>
            {touched && timeMissing ? <FieldError>{m.schedule_required()}</FieldError> : null}
          </Field>
          <Field className="col-span-2" data-invalid={(touched && timeInvalid) || undefined}>
            <FieldLabel htmlFor={`${fid}-5`}>{m.schedule_ends()}</FieldLabel>
            <div className="flex gap-2">
              <Popover open={endOpen} onOpenChange={setEndOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      id={`${fid}-5`}
                      type="button"
                      variant="outline"
                      aria-invalid={(touched && timeInvalid) || undefined}
                      data-empty={!endSelected}
                      className="w-full min-w-0 flex-1 justify-start text-left font-normal data-[empty=true]:text-muted-foreground"
                    />
                  }
                >
                  <CalendarIcon data-icon="inline-start" />
                  {endSelected ? formatDate(endDay) : m.schedule_date_placeholder()}
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={endSelected}
                    defaultMonth={endSelected}
                    {...calendar}
                    onSelect={(next) => {
                      const day = next ? isoDay(next) : ''
                      set('end', day ? withDay(draft.end, day) : withClock('', clock(draft.end)))
                      setEndOpen(false)
                    }}
                  />
                </PopoverContent>
              </Popover>
              {draft.all_day ? null : (
                <InputGroup className="w-32 shrink-0">
                  <InputGroupInput
                    type="time"
                    aria-label={m.schedule_end_time()}
                    className={TIME_INPUT}
                    value={clock(draft.end)}
                    onChange={(input) => set('end', withClock(draft.end, input.target.value))}
                  />
                  <InputGroupAddon>
                    <Clock2 aria-hidden />
                  </InputGroupAddon>
                </InputGroup>
              )}
            </div>
            {touched && timeInvalid ? (
              <FieldError>{m.error_schedule_time_range_invalid()}</FieldError>
            ) : null}
          </Field>
          <Field className="col-span-2">
            <FieldLabel htmlFor={`${fid}-6`}>{m.schedule_location()}</FieldLabel>
            <Input
              id={`${fid}-6`}
              value={draft.location}
              onChange={(e) => set('location', e.target.value)}
            />
          </Field>
          <Field className="col-span-2">
            <FieldLabel htmlFor={`${fid}-7`}>{m.schedule_note()}</FieldLabel>
            <Textarea
              id={`${fid}-7`}
              rows={2}
              value={draft.note}
              onChange={(e) => set('note', e.target.value)}
            />
          </Field>
          <DialogFooter className="col-span-2">
            {event ? (
              <Button
                type="button"
                variant="destructive"
                className="mr-auto"
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
