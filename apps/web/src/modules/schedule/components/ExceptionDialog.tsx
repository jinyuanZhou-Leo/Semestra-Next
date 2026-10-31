import type { Meeting } from '@semestra/api-client'
import { scheduleExceptionUpsertMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarIcon, Clock2 } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { ChoiceControl } from '@/app/settings'
import { calendarLocale } from '@/lib/calendar'
import { isoDay } from '@/lib/day'
import { toastError } from '@/lib/errors'
import { formatDate, formatTime } from '@/lib/format'
import { TIME_INPUT } from '@/lib/time-input'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Calendar } from '@/ui/calendar'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Field, FieldError, FieldLabel, FieldTitle } from '@/ui/field'
import { Input } from '@/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
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
import { sectionLabel } from '../labels'
import { invalidateSchedule } from '../queries'
import { localDay, weekdayName } from '../time'

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A date field: a button that opens a calendar; `allowed` limits the days that can be picked. */
function DateField({
  id,
  value,
  onChange,
  allowed,
  invalid,
}: {
  id: string
  value: string
  onChange: (day: string) => void
  allowed?: (day: Date) => boolean
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const picked = DAY.test(value) ? localDay(value) : undefined
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            aria-invalid={invalid || undefined}
            data-empty={!picked}
            className="w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground"
          />
        }
      >
        <CalendarIcon data-icon="inline-start" />
        {picked ? formatDate(value) : m.schedule_date_placeholder()}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          {...calendarLocale()}
          mode="single"
          selected={picked}
          defaultMonth={picked}
          disabled={allowed ? (day) => !allowed(day) : undefined}
          onSelect={(next) => {
            onChange(next ? isoDay(next) : '')
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

const hhmm = (time: string) => time.slice(0, 5)

/**
 * Cancels or moves one class of a course's meetings (M04 §5.3): the class is picked by its
 * section and date, as the calendar does it from a clicked class.
 */
export function ExceptionDialog({
  meetings,
  open,
  onOpenChange,
}: {
  meetings: Meeting[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fid = useId()
  const queryClient = useQueryClient()
  const [meetingId, setMeetingId] = useState(meetings[0]?.id ?? '')
  const [originalDate, setOriginalDate] = useState('')
  const [kind, setKind] = useState<'cancelled' | 'moved'>('cancelled')
  const [date, setDate] = useState('')
  // null: not edited, so the class's own time and room.
  const [start, setStart] = useState<string | null>(null)
  const [end, setEnd] = useState<string | null>(null)
  const [location, setLocation] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const meeting = meetings.find((mt) => mt.id === meetingId)

  const save = useMutation({
    ...scheduleExceptionUpsertMutation(),
    onError: toastError,
    onSuccess: async () => {
      await invalidateSchedule(queryClient)
      onOpenChange(false)
    },
  })

  // A moved class starts from the class as it was: its day, time and room.
  const pickMeeting = (id: string) => {
    setMeetingId(id)
    setOriginalDate('')
    setStart(null)
    setEnd(null)
    setLocation(null)
  }
  const pickOriginal = (day: string) => {
    setOriginalDate(day)
    if (!date) setDate(day)
  }
  const shownStart = start ?? (meeting ? hhmm(meeting.start_time) : '')
  const shownEnd = end ?? (meeting ? hhmm(meeting.end_time) : '')
  const shownLocation = location ?? meeting?.location ?? ''

  const dateMissing = !DAY.test(originalDate)
  const newDateMissing = kind === 'moved' && !DAY.test(date)
  const timeInvalid = kind === 'moved' && (!shownStart || !shownEnd || shownStart >= shownEnd)
  const invalid = !meeting || dateMissing || newDateMissing || timeInvalid

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (invalid) return
    save.mutate({
      path: { meeting_id: meeting.id, original_date: originalDate },
      body:
        kind === 'cancelled'
          ? { kind, note: note.trim() || null }
          : {
              kind,
              new_date: date,
              new_start_time: shownStart,
              new_end_time: shownEnd,
              // An empty string clears the room for this class; null would keep the meeting's.
              new_location: shownLocation.trim(),
              note: note.trim() || null,
            },
    })
  }

  const items = meetings.map((mt) => ({
    value: mt.id,
    label: `${sectionLabel(mt)} · ${weekdayName(mt.weekday, 'short')} ${formatTime(mt.start_time)} – ${formatTime(mt.end_time)}`,
  }))

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.schedule_exception_add()}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="grid grid-cols-6 gap-4">
          <Field className="col-span-4">
            <FieldLabel htmlFor={`${fid}-1`}>{m.schedule_exception_meeting()}</FieldLabel>
            <Select
              value={meetingId}
              items={items}
              onValueChange={(next) => next && pickMeeting(next)}
            >
              <SelectTrigger id={`${fid}-1`} className="w-full">
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
          </Field>
          <Field className="col-span-2" data-invalid={(touched && dateMissing) || undefined}>
            <FieldLabel htmlFor={`${fid}-2`}>{m.schedule_exception_date()}</FieldLabel>
            <DateField
              id={`${fid}-2`}
              value={originalDate}
              onChange={pickOriginal}
              // Only the days the class meets (weekday 1 = Monday … 7 = Sunday).
              allowed={meeting ? (day) => (day.getDay() || 7) === meeting.weekday : undefined}
              invalid={touched && dateMissing}
            />
          </Field>
          <Field className="col-span-6">
            <FieldTitle id={`${fid}-kind`}>{m.schedule_exception_kind()}</FieldTitle>
            <ChoiceControl<'cancelled' | 'moved'>
              labelId={`${fid}-kind`}
              value={kind}
              onChange={setKind}
              options={[
                { value: 'cancelled', label: m.schedule_exception_cancel() },
                { value: 'moved', label: m.schedule_exception_move() },
              ]}
            />
          </Field>
          {kind === 'moved' ? (
            <>
              <Field className="col-span-2" data-invalid={(touched && newDateMissing) || undefined}>
                <FieldLabel htmlFor={`${fid}-3`}>{m.schedule_exception_new_date()}</FieldLabel>
                <DateField
                  id={`${fid}-3`}
                  value={date}
                  onChange={setDate}
                  invalid={touched && newDateMissing}
                />
              </Field>
              <Field className="col-span-2">
                <FieldLabel htmlFor={`${fid}-4`}>{m.schedule_start_time()}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id={`${fid}-4`}
                    type="time"
                    className={TIME_INPUT}
                    value={shownStart}
                    onChange={(e) => setStart(e.target.value)}
                  />
                  <InputGroupAddon>
                    <Clock2 aria-hidden />
                  </InputGroupAddon>
                </InputGroup>
              </Field>
              <Field className="col-span-2" data-invalid={(touched && timeInvalid) || undefined}>
                <FieldLabel htmlFor={`${fid}-5`}>{m.schedule_end_time()}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id={`${fid}-5`}
                    aria-invalid={(touched && timeInvalid) || undefined}
                    type="time"
                    className={TIME_INPUT}
                    value={shownEnd}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                  <InputGroupAddon>
                    <Clock2 aria-hidden />
                  </InputGroupAddon>
                </InputGroup>
                {touched && timeInvalid ? (
                  <FieldError>{m.error_schedule_time_range_invalid()}</FieldError>
                ) : null}
              </Field>
              <Field className="col-span-6">
                <FieldLabel htmlFor={`${fid}-6`}>{m.schedule_location()}</FieldLabel>
                <Input
                  id={`${fid}-6`}
                  value={shownLocation}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </Field>
            </>
          ) : null}
          <Field className="col-span-6">
            <FieldLabel htmlFor={`${fid}-7`}>{m.schedule_note()}</FieldLabel>
            <Textarea
              id={`${fid}-7`}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <DialogFooter className="col-span-6">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? m.common_saving() : m.common_save()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
