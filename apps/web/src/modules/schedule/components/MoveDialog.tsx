import { scheduleExceptionUpsertMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { Textarea } from '@/ui/textarea'
import { invalidateSchedule } from '../queries'
import { Field } from './Field'

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
  const queryClient = useQueryClient()
  const [date, setDate] = useState(target.date)
  const [start, setStart] = useState(target.start)
  const [end, setEnd] = useState(target.end)
  const [location, setLocation] = useState(target.location)
  const [note, setNote] = useState(target.note)
  const [touched, setTouched] = useState(false)
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
        new_location: location.trim() || null,
        note: note.trim() || null,
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent closeLabel={m.common_close()}>
        <DialogHeader>
          <DialogTitle>{m.schedule_move_title()}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="grid grid-cols-3 gap-4">
          <Field label={m.schedule_date()}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={m.schedule_start_time()}>
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field
            label={m.schedule_end_time()}
            error={touched && invalid ? m.error_schedule_time_range_invalid() : null}
          >
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label={m.schedule_location()} className="col-span-3">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <Field label={m.schedule_note()} className="col-span-3">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
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
