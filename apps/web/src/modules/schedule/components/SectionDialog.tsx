import type { Meeting } from '@semestra/api-client'
import { scheduleSectionSaveMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock2, Plus, X } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { ChoiceControl } from '@/app/settings'
import { toastError } from '@/lib/errors'
import { TIME_INPUT } from '@/lib/time-input'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/ui/field'
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
import { typeName } from '../labels'
import { invalidateSchedule, useEventTypes } from '../queries'
import { weekdayName } from '../time'

/** A time row; `id` is the meeting it edits, absent for a new one. */
type Time = {
  key: number
  id?: string
  weekday: string
  start: string
  end: string
  location: string
}

/** A new time starts from the last one: same hours and room, the next day. */
function nextTime(all: readonly Time[]): Time {
  const last = all.at(-1)!
  return {
    ...last,
    id: undefined,
    key: Math.max(...all.map((t) => t.key)) + 1,
    weekday: String((Number(last.weekday) % 7) + 1),
  }
}

const weeksKey = (mt: Meeting) =>
  [mt.recurrence, mt.anchor_week, mt.start_week, mt.end_week, mt.skip_breaks].join('|')

const int = (value: string) => (value.trim() === '' ? null : Number.parseInt(value, 10))

/**
 * Adds a section with one or more weekly times at once, or edits one (M04 §5.3): what a
 * timetable lists as "LEC0101 — Mon, Wed, Fri 10:00". The times share the section's weeks; a
 * section whose times have different weeks keeps each time's own (change them per time).
 */
export function SectionDialog({
  programId,
  courseId,
  termId,
  typeCode,
  meetings = [],
  withNewTime = false,
  open,
  onOpenChange,
}: {
  programId: string
  courseId: string
  termId: string
  typeCode: string
  /** The section's meetings when editing it. */
  meetings?: readonly Meeting[]
  /** Opens with a new time after the section's own ("Add a time" of a section). */
  withNewTime?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const fid = useId()
  const queryClient = useQueryClient()
  const types = useEventTypes(programId).data?.items ?? []
  const first = meetings[0]
  const editing = first !== undefined
  // The weeks fields edit every time only when the times share them.
  const sharedWeeks = new Set(meetings.map(weeksKey)).size <= 1
  const [type, setType] = useState(first?.type_code ?? typeCode)
  const [code, setCode] = useState(first?.section_code ?? '')
  const [instructor, setInstructor] = useState(
    meetings.find((mt) => mt.instructor)?.instructor ?? '',
  )
  const [times, setTimes] = useState<Time[]>(() => {
    if (!editing) return [{ key: 0, weekday: '1', start: '09:00', end: '10:00', location: '' }]
    const own = meetings.map((mt, key) => ({
      key,
      id: mt.id,
      weekday: String(mt.weekday),
      start: mt.start_time.slice(0, 5),
      end: mt.end_time.slice(0, 5),
      location: mt.location ?? '',
    }))
    return withNewTime ? [...own, nextTime(own)] : own
  })
  const [recurrence, setRecurrence] = useState<'weekly' | 'biweekly'>(first?.recurrence ?? 'weekly')
  const [anchorWeek, setAnchorWeek] = useState(String(first?.anchor_week ?? 1))
  const [startWeek, setStartWeek] = useState(String(first?.start_week ?? 1))
  const [endWeek, setEndWeek] = useState(first?.end_week != null ? String(first.end_week) : '')
  const [skipBreaks, setSkipBreaks] = useState(first?.skip_breaks ?? true)
  const [touched, setTouched] = useState(false)

  // One request for the whole section (`schedule.section.save`): its times are updated,
  // added and deleted together, so a failed save leaves nothing half done.
  const save = useMutation({
    ...scheduleSectionSaveMutation(),
    onError: toastError,
    onSettled: () => invalidateSchedule(queryClient),
    onSuccess: () => onOpenChange(false),
  })

  const setTime = (key: number, patch: Partial<Time>) =>
    setTimes((all) => all.map((t) => (t.key === key ? { ...t, ...patch } : t)))
  const addTime = () => setTimes((all) => [...all, nextTime(all)])

  const start = int(startWeek)
  const end = int(endWeek)
  const weeksInvalid = start === null || start < 1 || (end !== null && end < start)
  const badTimes = new Set(
    times.filter((t) => !t.start || !t.end || t.start >= t.end).map((t) => t.key),
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if ((sharedWeeks && weeksInvalid) || badTimes.size > 0) return
    save.mutate({
      path: { course_id: courseId },
      body: {
        term_id: first?.term_id ?? termId,
        meeting_ids: meetings.map((mt) => mt.id),
        type_code: type,
        section_code: code.trim(),
        instructor: instructor.trim() || null,
        // Without weeks, the times keep theirs and new ones take the section's (server side).
        weeks: sharedWeeks
          ? {
              recurrence,
              anchor_week: recurrence === 'biweekly' ? (int(anchorWeek) ?? 1) : null,
              start_week: start ?? 1,
              end_week: end,
              skip_breaks: skipBreaks,
            }
          : null,
        times: times.map((t) => ({
          meeting_id: t.id ?? null,
          weekday: Number(t.weekday),
          start_time: t.start,
          end_time: t.end,
          location: t.location.trim() || null,
        })),
      },
    })
  }

  const typeItems = types.map((t) => ({ value: t.code, label: `${t.code} · ${typeName(t)}` }))
  if (!typeItems.some((o) => o.value === type)) typeItems.push({ value: type, label: type })
  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: weekdayName(d) }))

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? m.schedule_section_edit() : m.schedule_section_new_title()}
          </DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-6">
          <div className="grid grid-cols-3 gap-4">
            <Field>
              <FieldLabel htmlFor={`${fid}-type`}>{m.schedule_type()}</FieldLabel>
              <Select
                value={type}
                items={typeItems}
                onValueChange={(next) => next && setType(next)}
              >
                <SelectTrigger id={`${fid}-type`} className="w-full">
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
            <Field>
              <FieldLabel htmlFor={`${fid}-code`}>{m.schedule_section_code()}</FieldLabel>
              <Input
                id={`${fid}-code`}
                placeholder={`${type}0101`}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${fid}-instructor`}>{m.schedule_instructor()}</FieldLabel>
              <Input
                id={`${fid}-instructor`}
                value={instructor}
                onChange={(e) => setInstructor(e.target.value)}
              />
            </Field>
          </div>

          <FieldSet className="gap-3">
            <FieldLegend variant="label">{m.schedule_section_times()}</FieldLegend>
            {times.map((t) => (
              <div
                key={t.key}
                className="grid grid-cols-[8rem_1fr_1fr_1.4fr_auto] items-start gap-2"
              >
                <Select
                  value={t.weekday}
                  items={weekdays}
                  onValueChange={(next) => next && setTime(t.key, { weekday: next })}
                >
                  <SelectTrigger aria-label={m.schedule_weekday()} className="w-full">
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
                <InputGroup>
                  <InputGroupInput
                    aria-label={m.schedule_start_time()}
                    type="time"
                    className={TIME_INPUT}
                    value={t.start}
                    onChange={(e) => setTime(t.key, { start: e.target.value })}
                  />
                  <InputGroupAddon>
                    <Clock2 aria-hidden />
                  </InputGroupAddon>
                </InputGroup>
                <Field data-invalid={(touched && badTimes.has(t.key)) || undefined}>
                  <InputGroup>
                    <InputGroupInput
                      aria-label={m.schedule_end_time()}
                      aria-invalid={(touched && badTimes.has(t.key)) || undefined}
                      type="time"
                      className={TIME_INPUT}
                      value={t.end}
                      onChange={(e) => setTime(t.key, { end: e.target.value })}
                    />
                    <InputGroupAddon>
                      <Clock2 aria-hidden />
                    </InputGroupAddon>
                  </InputGroup>
                  {touched && badTimes.has(t.key) ? (
                    <FieldError>{m.error_schedule_time_range_invalid()}</FieldError>
                  ) : null}
                </Field>
                <Input
                  aria-label={m.schedule_location()}
                  placeholder={m.schedule_location()}
                  value={t.location}
                  onChange={(e) => setTime(t.key, { location: e.target.value })}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  aria-label={m.schedule_section_time_remove()}
                  disabled={times.length === 1}
                  onClick={() => setTimes((all) => all.filter((x) => x.key !== t.key))}
                >
                  <X aria-hidden />
                </Button>
              </div>
            ))}
            <div>
              <Button type="button" size="sm" variant="ghost" onClick={addTime}>
                <Plus aria-hidden />
                {m.schedule_section_time_add()}
              </Button>
            </div>
          </FieldSet>

          {sharedWeeks ? (
            <FieldSet className="gap-3">
              <FieldLegend variant="label">{m.schedule_section_weeks()}</FieldLegend>
              <FieldDescription>{m.schedule_section_weeks_hint()}</FieldDescription>
              <div className="flex flex-wrap items-end gap-4">
                <Field className="w-auto">
                  <FieldTitle id={`${fid}-recurrence`}>{m.schedule_recurrence()}</FieldTitle>
                  <div className="flex h-9 items-center">
                    <ChoiceControl<'weekly' | 'biweekly'>
                      labelId={`${fid}-recurrence`}
                      value={recurrence}
                      onChange={setRecurrence}
                      options={[
                        { value: 'weekly', label: m.schedule_recurrence_weekly() },
                        { value: 'biweekly', label: m.schedule_recurrence_biweekly() },
                      ]}
                    />
                  </div>
                </Field>
                {recurrence === 'biweekly' ? (
                  <Field className="w-28">
                    <FieldLabel htmlFor={`${fid}-anchor`}>{m.schedule_anchor_week()}</FieldLabel>
                    <Input
                      id={`${fid}-anchor`}
                      type="number"
                      min={1}
                      value={anchorWeek}
                      onChange={(e) => setAnchorWeek(e.target.value)}
                    />
                  </Field>
                ) : null}
                <Field className="w-24">
                  <FieldLabel htmlFor={`${fid}-start`}>{m.schedule_start_week()}</FieldLabel>
                  <Input
                    id={`${fid}-start`}
                    type="number"
                    min={1}
                    value={startWeek}
                    onChange={(e) => setStartWeek(e.target.value)}
                  />
                </Field>
                <Field className="w-24" data-invalid={(touched && weeksInvalid) || undefined}>
                  <FieldLabel htmlFor={`${fid}-end`}>{m.schedule_end_week()}</FieldLabel>
                  <Input
                    id={`${fid}-end`}
                    aria-invalid={(touched && weeksInvalid) || undefined}
                    type="number"
                    min={1}
                    placeholder={m.schedule_end_week_placeholder()}
                    value={endWeek}
                    onChange={(e) => setEndWeek(e.target.value)}
                  />
                  {touched && weeksInvalid ? (
                    <FieldError>{m.error_schedule_week_range_invalid()}</FieldError>
                  ) : null}
                </Field>
              </div>
              <Field orientation="horizontal" className="w-auto">
                <Checkbox
                  id={`${fid}-skip`}
                  checked={skipBreaks}
                  onCheckedChange={(checked) => setSkipBreaks(checked)}
                />
                <FieldLabel htmlFor={`${fid}-skip`} className="font-normal">
                  {m.schedule_skip_breaks()}
                </FieldLabel>
              </Field>
            </FieldSet>
          ) : (
            <FieldDescription>{m.schedule_section_weeks_differ()}</FieldDescription>
          )}

          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? m.common_saving() : m.common_save()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
