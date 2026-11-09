import type { Meeting, Section } from '@semestra/api-client'
import {
  scheduleMeetingDeleteMutation,
  scheduleMeetingUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock2 } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { SettingRow, SettingsGroup } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { calendarLocale } from '@/lib/calendar'
import { toastError } from '@/lib/errors'
import { SEGMENT, SEGMENTED } from '@/lib/segmented'
import { TIME_INPUT } from '@/lib/time-input'
import { cn } from '@/lib/utils'
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
import { FieldError } from '@/ui/field'
import { Input } from '@/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'
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
  onOpenChangeComplete,
  onOpenChange,
}: {
  section: Section
  meeting: Meeting
  open: boolean
  /** Clear what the dialog is about here, once it has closed (`useDialogTarget`). */
  onOpenChangeComplete?: (open: boolean) => void
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

  // The week as the calendar shows it: Sunday first when the week starts on Sunday.
  const weekdays =
    calendarLocale().weekStartsOn === 0 ? [7, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 7]
  const timeError = touched && timeInvalid
  // One character a day where that tells the days apart (一…日), otherwise the short names.
  const narrow = weekdays.map((day) => weekdayName(day, 'narrow'))
  const dayLabels =
    new Set(narrow).size === 7 ? narrow : weekdays.map((d) => weekdayName(d, 'short'))

  return (
    <Dialog
      open={open}
      onOpenChangeComplete={onOpenChangeComplete}
      onOpenChange={(next) => !update.isPending && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{m.schedule_meeting_edit()}</DialogTitle>
          <DialogDescription>{sectionLabel(section)}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <SettingsGroup>
              <SettingRow label={m.schedule_weekday()}>
                {(labelId) => (
                  <ToggleGroup
                    aria-labelledby={labelId}
                    size="sm"
                    className={SEGMENTED}
                    value={[weekday]}
                    onValueChange={(next) => next[0] && setWeekday(next[0])}
                  >
                    {weekdays.map((day, index) => (
                      <ToggleGroupItem
                        key={day}
                        value={String(day)}
                        aria-label={weekdayName(day)}
                        className={cn(SEGMENT, 'min-w-8 px-2')}
                      >
                        {dayLabels[index]}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                )}
              </SettingRow>
              <SettingRow
                label={m.schedule_time()}
                htmlFor={`${fid}-start`}
                note={
                  timeError ? (
                    <FieldError id={`${fid}-time-error`}>
                      {m.error_schedule_time_range_invalid()}
                    </FieldError>
                  ) : null
                }
              >
                <div className="flex items-center gap-2">
                  <InputGroup className="w-32">
                    <InputGroupInput
                      id={`${fid}-start`}
                      type="time"
                      aria-label={m.schedule_start_time()}
                      className={TIME_INPUT}
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                    />
                    <InputGroupAddon>
                      <Clock2 aria-hidden />
                    </InputGroupAddon>
                  </InputGroup>
                  <span aria-hidden className="text-muted-foreground">
                    –
                  </span>
                  <InputGroup className="w-32">
                    <InputGroupInput
                      type="time"
                      aria-label={m.schedule_end_time()}
                      aria-invalid={timeError || undefined}
                      aria-describedby={timeError ? `${fid}-time-error` : undefined}
                      className={TIME_INPUT}
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                    />
                    <InputGroupAddon>
                      <Clock2 aria-hidden />
                    </InputGroupAddon>
                  </InputGroup>
                </div>
              </SettingRow>
            </SettingsGroup>
            <SettingsGroup>
              <SettingRow label={m.schedule_location()} htmlFor={`${fid}-location`}>
                <Input
                  id={`${fid}-location`}
                  className="w-64"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </SettingRow>
              <SettingRow label={m.schedule_meeting_title()} htmlFor={`${fid}-title`}>
                <Input
                  id={`${fid}-title`}
                  className="w-64"
                  placeholder={m.schedule_meeting_title_placeholder()}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </SettingRow>
            </SettingsGroup>
          </div>
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
