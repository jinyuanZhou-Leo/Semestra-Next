import type { Meeting, Section } from '@semestra/api-client'
import {
  scheduleMeetingDeleteMutation,
  scheduleMeetingUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock2 } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toastError } from '@/lib/errors'
import { TIME_INPUT } from '@/lib/time-input'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { sectionLabel } from '../labels'
import { invalidateSchedule } from '../queries'
import { weekdayName } from '../time'

/**
 * Edits one time of a section (M04 §5.3): its day, hours, room and an optional title. What the
 * section's times share (type, code, instructor, weeks) is edited with the section.
 */
export function MeetingDialog({
  section,
  meeting,
  open,
  onOpenChange,
}: {
  section: Section
  meeting: Meeting
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fid = useId()
  const queryClient = useQueryClient()
  const [weekday, setWeekday] = useState(String(meeting.weekday))
  const [start, setStart] = useState(meeting.start_time.slice(0, 5))
  const [end, setEnd] = useState(meeting.end_time.slice(0, 5))
  const [location, setLocation] = useState(meeting.location ?? '')
  const [title, setTitle] = useState(meeting.title ?? '')
  const [touched, setTouched] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const done = async () => {
    await invalidateSchedule(queryClient)
    onOpenChange(false)
  }
  const update = useMutation({
    ...scheduleMeetingUpdateMutation(),
    onError: toastError,
    onSuccess: done,
  })
  const remove = useMutation({
    ...scheduleMeetingDeleteMutation(),
    onError: toastError,
    onSuccess: async () => {
      setDeleting(false)
      await done()
    },
  })

  const timeInvalid = !start || !end || start >= end
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (timeInvalid) return
    update.mutate({
      path: { meeting_id: meeting.id },
      body: {
        weekday: Number(weekday),
        start_time: start,
        end_time: end,
        location: location.trim() || null,
        title: title.trim() || null,
      },
    })
  }

  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: weekdayName(d) }))

  return (
    <Dialog open={open} onOpenChange={(next) => !update.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{m.schedule_meeting_edit()}</DialogTitle>
          <DialogDescription>{sectionLabel(section)}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-6">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${fid}-day`}>{m.schedule_weekday()}</FieldLabel>
              <Select
                value={weekday}
                items={weekdays}
                onValueChange={(next) => next && setWeekday(next)}
              >
                <SelectTrigger id={`${fid}-day`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {weekdays.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor={`${fid}-start`}>{m.schedule_start_time()}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id={`${fid}-start`}
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
              <Field data-invalid={(touched && timeInvalid) || undefined}>
                <FieldLabel htmlFor={`${fid}-end`}>{m.schedule_end_time()}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id={`${fid}-end`}
                    aria-invalid={(touched && timeInvalid) || undefined}
                    type="time"
                    className={TIME_INPUT}
                    value={end}
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
            </div>
            <Field>
              <FieldLabel htmlFor={`${fid}-location`}>{m.schedule_location()}</FieldLabel>
              <Input
                id={`${fid}-location`}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${fid}-title`}>{m.schedule_meeting_title()}</FieldLabel>
              <Input
                id={`${fid}-title`}
                placeholder={m.schedule_meeting_title_placeholder()}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
              className="mr-auto"
              disabled={update.isPending}
              onClick={() => setDeleting(true)}
            >
              {m.schedule_meeting_delete()}
            </Button>
            <DialogClose
              render={<Button type="button" variant="outline" disabled={update.isPending} />}
            >
              {m.common_cancel()}
            </DialogClose>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? m.common_saving() : m.common_save()}
            </Button>
          </DialogFooter>
        </form>
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={m.schedule_meeting_delete_title()}
          description={m.schedule_meeting_delete_description()}
          confirmLabel={m.schedule_meeting_delete()}
          pending={remove.isPending}
          onConfirm={() => remove.mutate({ path: { meeting_id: meeting.id } })}
        />
      </DialogContent>
    </Dialog>
  )
}
