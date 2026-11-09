import type { Term } from '@semestra/api-client'
import { scheduleExceptionUpsertMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { Clock2 } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { ChoiceControl, SettingRow, SettingsGroup } from '@/app/settings'
import { DateField } from '@/components/DateField'
import { COLLAPSE } from '@/lib/collapse'
import { isoDay, plusDays } from '@/lib/day'
import { toastError } from '@/lib/errors'
import { formatTime } from '@/lib/format'
import { TIME_INPUT } from '@/lib/time-input'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Collapsible, CollapsibleContent } from '@/ui/collapsible'
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
import type { SectionTime } from '../sections'
import { useTerms } from '@/modules/academics/queries'
import { invalidateSchedule, occurrenceOptions } from '../queries'
import { weekdayName } from '../time'

const DAY = /^\d{4}-\d{2}-\d{2}$/

const hhmm = (time: string) => time.slice(0, 5)

/**
 * The days each meeting of the course really meets in the term, from the calendar (term weeks,
 * every-other-week, week range and breaks already applied), keyed by meeting id. The calendar
 * answers at most `MAX_RANGE_DAYS` (120) days per request, so a long term is asked in parts.
 */
function useClassDays(programId: string, courseId: string, term: Term | undefined) {
  const windows: Array<{ start: string; end: string }> = []
  if (term) {
    const last = plusDays(term.end_date, 1)
    for (let day = term.start_date; day < last; day = plusDays(day, 120)) {
      const end = plusDays(day, 120)
      windows.push({ start: day, end: end < last ? end : last })
    }
  }
  return useQueries({
    queries: windows.map((w) =>
      occurrenceOptions(programId, {
        ...w,
        term_id: term?.id,
        course_ids: [courseId],
        sources: ['schedule.meetings'],
        kinds: ['class'],
      }),
    ),
    combine: (results) => {
      if (!term || results.some((r) => !r.data)) return null
      const days = new Map<string, Set<string>>()
      for (const r of results) {
        for (const o of r.data?.items ?? []) {
          const id = o.meta?.meeting_id
          const day = o.meta?.original_date
          if (!id || !day) continue
          const set = days.get(id) ?? new Set<string>()
          set.add(day)
          days.set(id, set)
        }
      }
      return days
    },
  })
}

/**
 * Cancels or moves one class of a course's meetings (M04 §5.3): the class is picked by its
 * section and date, as the calendar does it from a clicked class.
 */
export function ExceptionDialog({
  programId,
  courseId,
  termId,
  today,
  times,
  open,
  onOpenChangeComplete,
  onOpenChange,
}: {
  programId: string
  courseId: string
  termId: string
  /** Today in the Program's time zone. */
  today: string
  /** The times that can be picked: the switched-on ones, in the tables' order. */
  times: SectionTime[]
  open: boolean
  /** Clear what the dialog is about here, once it has closed (`useDialogTarget`). */
  onOpenChangeComplete?: (open: boolean) => void
  onOpenChange: (open: boolean) => void
}) {
  const fid = useId()
  const queryClient = useQueryClient()
  const [meetingId, setMeetingId] = useState(times[0]?.meeting.id ?? '')
  const [originalDate, setOriginalDate] = useState('')
  const [kind, setKind] = useState<'cancelled' | 'moved'>('cancelled')
  const [date, setDate] = useState('')
  // null: not edited, so the class's own time and room.
  const [start, setStart] = useState<string | null>(null)
  const [end, setEnd] = useState<string | null>(null)
  const [location, setLocation] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const meeting = times.find((t) => t.meeting.id === meetingId)?.meeting
  const term = useTerms(programId).data?.items.find((t) => t.id === termId)
  const classDays = useClassDays(programId, courseId, term)
  const meetingDays = meeting ? classDays?.get(meeting.id) : undefined
  const termRange = term ? { start: term.start_date, end: term.end_date, today } : undefined

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

  const items = times.map(({ section, meeting: mt }) => ({
    value: mt.id,
    label: `${sectionLabel(section)} · ${weekdayName(mt.weekday, 'short')} ${formatTime(mt.start_time)} – ${formatTime(mt.end_time)}`,
  }))
  const timeError = touched && timeInvalid

  return (
    <Dialog
      open={open}
      onOpenChangeComplete={onOpenChangeComplete}
      onOpenChange={(next) => !save.isPending && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{m.schedule_exception_add()}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <SettingsGroup>
              <SettingRow label={m.schedule_exception_meeting()} htmlFor={`${fid}-meeting`}>
                <Select
                  value={meetingId}
                  items={items}
                  onValueChange={(next) => next && pickMeeting(next)}
                >
                  <SelectTrigger id={`${fid}-meeting`} className="w-72">
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
              </SettingRow>
              <SettingRow
                label={m.schedule_exception_date()}
                htmlFor={`${fid}-date`}
                note={
                  touched && dateMissing ? <FieldError>{m.schedule_required()}</FieldError> : null
                }
              >
                <DateField
                  id={`${fid}-date`}
                  className="w-44"
                  value={originalDate}
                  onChange={pickOriginal}
                  placeholder={m.schedule_date_placeholder()}
                  // Only the days this section really meets in the term.
                  allowed={(day) => meetingDays?.has(isoDay(day)) ?? false}
                  range={termRange}
                  invalid={touched && dateMissing}
                />
              </SettingRow>
              <SettingRow label={m.schedule_exception_kind()}>
                {(labelId) => (
                  <ChoiceControl<'cancelled' | 'moved'>
                    labelId={labelId}
                    value={kind}
                    onChange={setKind}
                    options={[
                      { value: 'cancelled', label: m.schedule_exception_cancel() },
                      { value: 'moved', label: m.schedule_exception_move() },
                    ]}
                  />
                )}
              </SettingRow>
            </SettingsGroup>
            {/* A moved class's new day, time and room slide in under the choice. */}
            <Collapsible open={kind === 'moved'}>
              <CollapsibleContent className={COLLAPSE}>
                <SettingsGroup>
                  <SettingRow
                    label={m.schedule_exception_new_date()}
                    htmlFor={`${fid}-new-date`}
                    note={
                      touched && newDateMissing ? (
                        <FieldError>{m.schedule_required()}</FieldError>
                      ) : null
                    }
                  >
                    <DateField
                      id={`${fid}-new-date`}
                      className="w-44"
                      value={date}
                      onChange={setDate}
                      placeholder={m.schedule_date_placeholder()}
                      invalid={touched && newDateMissing}
                    />
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
                          value={shownStart}
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
                          value={shownEnd}
                          onChange={(e) => setEnd(e.target.value)}
                        />
                        <InputGroupAddon>
                          <Clock2 aria-hidden />
                        </InputGroupAddon>
                      </InputGroup>
                    </div>
                  </SettingRow>
                  <SettingRow label={m.schedule_location()} htmlFor={`${fid}-location`}>
                    <Input
                      id={`${fid}-location`}
                      className="w-64"
                      value={shownLocation}
                      onChange={(e) => setLocation(e.target.value)}
                    />
                  </SettingRow>
                </SettingsGroup>
              </CollapsibleContent>
            </Collapsible>
            <Textarea
              aria-label={m.schedule_note()}
              placeholder={m.schedule_note()}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose
              render={<Button type="button" variant="outline" disabled={save.isPending} />}
            >
              {m.common_cancel()}
            </DialogClose>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? m.common_saving() : m.common_save()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
