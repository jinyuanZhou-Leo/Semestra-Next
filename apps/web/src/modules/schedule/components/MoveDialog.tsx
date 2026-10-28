import { scheduleExceptionUpsertMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarIcon, Clock2 } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { formatDate } from '@/lib/format'
import { toastError } from '@/lib/errors'
import { calendarLocale } from '@/lib/calendar'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Calendar } from '@/ui/calendar'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { TIME_INPUT } from '@/lib/time-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Textarea } from '@/ui/textarea'
import { invalidateSchedule } from '../queries'
import { isoDay, localDay } from '../time'

export type MoveTarget = {
  meetingId: string
  originalDate: string
  /** Current values (wall-clock, Program time zone). */
  date: string
  start: string
  end: string
  location: string
  note: string
}

/** Move one class to another day, time or room, as an exception of its meeting (M04 §2). */
export function MoveDialog({
  target,
  open,
  onOpenChange,
}: {
  target: MoveTarget
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fid = useId()
  const queryClient = useQueryClient()
  const [date, setDate] = useState(target.date)
  const [start, setStart] = useState(target.start)
  const [end, setEnd] = useState(target.end)
  const [location, setLocation] = useState(target.location)
  const [note, setNote] = useState(target.note)
  const [touched, setTouched] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const picked = /^\d{4}-\d{2}-\d{2}$/.test(date) ? localDay(date) : undefined
  const save = useMutation({
    ...scheduleExceptionUpsertMutation(),
    onError: toastError,
    onSuccess: async () => {
      await invalidateSchedule(queryClient)
      onOpenChange(false)
    },
  })
  const invalid = !date || start >= end

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (invalid) return
    save.mutate({
      path: { meeting_id: target.meetingId, original_date: target.originalDate },
      body: {
        kind: 'moved',
        new_date: date,
        new_start_time: start,
        new_end_time: end,
        // An empty string clears the room for this class; null would keep the meeting's.
        new_location: location.trim(),
        note: note.trim() || null,
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.schedule_move_title()}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="grid grid-cols-3 gap-4">
          <Field>
            <FieldLabel htmlFor={`${fid}-1`}>{m.schedule_date()}</FieldLabel>
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger
                render={
                  <Button
                    id={`${fid}-1`}
                    type="button"
                    variant="outline"
                    data-empty={!picked}
                    className="w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground"
                  />
                }
              >
                <CalendarIcon data-icon="inline-start" />
                {picked ? formatDate(date) : m.schedule_date_placeholder()}
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar
                  {...calendarLocale()}
                  mode="single"
                  selected={picked}
                  defaultMonth={picked}
                  onSelect={(next) => {
                    setDate(next ? isoDay(next) : '')
                    setDateOpen(false)
                  }}
                />
              </PopoverContent>
            </Popover>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fid}-2`}>{m.schedule_start_time()}</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id={`${fid}-2`}
                type="time"
                className={TIME_INPUT}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
              <InputGroupAddon>
                <Clock2 aria-hidden />
              </InputGroupAddon>
            </InputGroup>
          </Field>
          <Field data-invalid={(touched && invalid) || undefined}>
            <FieldLabel htmlFor={`${fid}-3`}>{m.schedule_end_time()}</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id={`${fid}-3`}
                aria-invalid={(touched && invalid) || undefined}
                type="time"
                className={TIME_INPUT}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
              <InputGroupAddon>
                <Clock2 aria-hidden />
              </InputGroupAddon>
            </InputGroup>
            {touched && invalid ? (
              <FieldError>{m.error_schedule_time_range_invalid()}</FieldError>
            ) : null}
          </Field>
          <Field className="col-span-3">
            <FieldLabel htmlFor={`${fid}-4`}>{m.schedule_location()}</FieldLabel>
            <Input id={`${fid}-4`} value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <Field className="col-span-3">
            <FieldLabel htmlFor={`${fid}-5`}>{m.schedule_note()}</FieldLabel>
            <Textarea
              id={`${fid}-5`}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <DialogFooter className="col-span-3">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? m.common_saving() : m.common_save()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
