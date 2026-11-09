import type { OneOffEvent } from '@semestra/api-client'
import {
  scheduleEventCreateMutation,
  scheduleEventDeleteMutation,
  scheduleEventUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock2 } from 'lucide-react'
import { type FormEvent, Suspense, useId, useState } from 'react'
import type { CalendarSourceContribution } from '@/app/extensions'
import { SettingRow, SettingsGroup } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { DateField } from '@/components/DateField'
import { toastError } from '@/lib/errors'
import { courseLabel } from '@/modules/academics/color'
import { useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { FieldError } from '@/ui/field'
import { Input } from '@/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { TIME_INPUT } from '@/lib/time-input'
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
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
import { typeName } from '../labels'
import { invalidateSchedule, useEventTypes } from '../queries'
import { plusDays } from '@/lib/day'
import { toWall } from '../time'

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

const EVENT = 'event'

/**
 * Add or edit a one-off event such as an exam or office hours (M04 §2). Times are entered in the
 * Program's time zone; the API reads times without an offset the same way. In the calendar a new
 * item can also be one of the sources that `create` (a to-do): a switch at the top picks which,
 * and that source's own form takes the dialog's place under it.
 */
export function EventDialog({
  programId,
  timezone,
  termId,
  courseId,
  event,
  slot,
  creators = [],
  open,
  onOpenChangeComplete,
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
  /** Calendar sources a new item can be instead of an event (needs `termId` and `slot`). */
  creators?: readonly CalendarSourceContribution[]
  open: boolean
  /** Clear what the dialog is about here, once it has closed (`useDialogTarget`). */
  onOpenChangeComplete?: (open: boolean) => void
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
  const kinds = event || !termId || !slot ? [] : creators.filter((c) => c.create)
  const [kind, setKind] = useState(EVENT)
  const creator = kinds.find((c) => c.source === kind)
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

  return (
    <Dialog
      open={open}
      onOpenChangeComplete={onOpenChangeComplete}
      onOpenChange={(next) => !pending && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {event
              ? m.schedule_event_edit()
              : kinds.length > 0
                ? m.schedule_new()
                : m.schedule_event_add()}
          </DialogTitle>
        </DialogHeader>
        {kinds.length > 0 ? (
          <ToggleGroup
            aria-label={m.schedule_new_kind()}
            size="sm"
            className={SEGMENTED}
            value={[kind]}
            onValueChange={(value) => value[0] && setKind(value[0])}
          >
            <ToggleGroupItem value={EVENT} className={SEGMENT}>
              {m.schedule_new_event()}
            </ToggleGroupItem>
            {kinds.map((c) => (
              <ToggleGroupItem key={c.source} value={c.source} className={SEGMENT}>
                {c.create!.label()}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
        {creator?.create && termId && slot ? (
          // The calendar preloads these forms as it opens the dialog; this covers a slow load.
          <Suspense fallback={<div className="h-40" />}>
            <creator.create.form
              programId={programId}
              termId={termId}
              start={slot.start}
              allDay={slot.allDay}
              onDone={() => void done()}
              onCancel={() => onOpenChange(false)}
            />
          </Suspense>
        ) : (
          <form noValidate onSubmit={submit} className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <SettingsGroup>
                <SettingRow
                  label={m.schedule_event_title()}
                  htmlFor={`${fid}-title`}
                  note={
                    touched && titleMissing ? (
                      <FieldError>{m.schedule_required()}</FieldError>
                    ) : null
                  }
                >
                  <Input
                    id={`${fid}-title`}
                    className="w-72"
                    aria-invalid={(touched && titleMissing) || undefined}
                    placeholder={m.schedule_event_title_placeholder()}
                    value={draft.title}
                    onChange={(e) => set('title', e.target.value)}
                  />
                </SettingRow>
                <SettingRow label={m.schedule_course()} htmlFor={`${fid}-course`}>
                  <Select
                    value={draft.course_id}
                    items={courseItems}
                    onValueChange={(next) => next && set('course_id', next)}
                  >
                    <SelectTrigger id={`${fid}-course`} className="w-72">
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
                </SettingRow>
                <SettingRow label={m.schedule_type()} htmlFor={`${fid}-type`}>
                  <Select
                    value={draft.type_code}
                    items={typeItems}
                    onValueChange={(next) => next && set('type_code', next)}
                  >
                    <SelectTrigger id={`${fid}-type`} className="w-72">
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
                </SettingRow>
              </SettingsGroup>
              <SettingsGroup>
                <SettingRow label={m.schedule_all_day()} htmlFor={`${fid}-all-day`}>
                  <Switch
                    id={`${fid}-all-day`}
                    checked={draft.all_day}
                    onCheckedChange={(on) => set('all_day', on)}
                  />
                </SettingRow>
                <SettingRow
                  label={m.schedule_starts()}
                  htmlFor={`${fid}-start`}
                  note={
                    touched && timeMissing ? <FieldError>{m.schedule_required()}</FieldError> : null
                  }
                >
                  <div className="flex gap-2">
                    <DateField
                      id={`${fid}-start`}
                      className="w-44"
                      value={startDay}
                      placeholder={m.schedule_date_placeholder()}
                      invalid={touched && timeMissing}
                      onChange={(day) =>
                        set(
                          'start',
                          day ? withDay(draft.start, day) : withClock('', clock(draft.start)),
                        )
                      }
                    />
                    {draft.all_day ? null : (
                      <InputGroup className="w-32 shrink-0">
                        <InputGroupInput
                          type="time"
                          aria-label={m.schedule_start_time()}
                          className={TIME_INPUT}
                          value={clock(draft.start)}
                          onChange={(input) =>
                            set('start', withClock(draft.start, input.target.value))
                          }
                        />
                        <InputGroupAddon>
                          <Clock2 aria-hidden />
                        </InputGroupAddon>
                      </InputGroup>
                    )}
                  </div>
                </SettingRow>
                <SettingRow
                  label={m.schedule_ends()}
                  htmlFor={`${fid}-end`}
                  note={
                    touched && timeInvalid ? (
                      <FieldError>{m.error_schedule_time_range_invalid()}</FieldError>
                    ) : null
                  }
                >
                  <div className="flex gap-2">
                    <DateField
                      id={`${fid}-end`}
                      className="w-44"
                      value={endDay}
                      placeholder={m.schedule_date_placeholder()}
                      invalid={touched && timeInvalid}
                      onChange={(day) =>
                        set('end', day ? withDay(draft.end, day) : withClock('', clock(draft.end)))
                      }
                    />
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
                </SettingRow>
              </SettingsGroup>
              <SettingsGroup>
                <SettingRow label={m.schedule_location()} htmlFor={`${fid}-location`}>
                  <Input
                    id={`${fid}-location`}
                    className="w-72"
                    value={draft.location}
                    onChange={(e) => set('location', e.target.value)}
                  />
                </SettingRow>
              </SettingsGroup>
              <Textarea
                aria-label={m.schedule_note()}
                placeholder={m.schedule_note()}
                rows={2}
                value={draft.note}
                onChange={(e) => set('note', e.target.value)}
              />
            </div>
            <DialogFooter>
              {event ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="mr-auto"
                  disabled={pending}
                  onClick={() => setDeleting(true)}
                >
                  {m.schedule_event_delete()}
                </Button>
              ) : null}
              <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>
                {m.common_cancel()}
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? m.common_saving() : m.common_save()}
              </Button>
            </DialogFooter>
          </form>
        )}
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
