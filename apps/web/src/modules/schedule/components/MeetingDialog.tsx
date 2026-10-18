import type { Meeting, MeetingCreateInputBody } from '@semestra/api-client'
import {
  scheduleMeetingCreateMutation,
  scheduleMeetingDeleteMutation,
  scheduleMeetingUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SegmentedControl } from '@/components/SegmentedControl'
import { toastError } from '@/lib/errors'
import { useTerms } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { typeName } from '../labels'
import { invalidateSchedule, useEventTypes } from '../queries'
import { weekdayName } from '../time'
import { Field, SimpleSelect } from './Field'

type Draft = {
  term_id: string
  section_code: string
  type_code: string
  title: string
  instructor: string
  location: string
  weekday: string
  start_time: string
  end_time: string
  recurrence: 'weekly' | 'biweekly'
  anchor_week: string
  start_week: string
  end_week: string
  skip_breaks: boolean
  enabled: boolean
}

function draftOf(meeting: Partial<Meeting> | undefined, termId: string, typeCode: string): Draft {
  return {
    term_id: meeting?.term_id ?? termId,
    section_code: meeting?.section_code ?? '',
    type_code: meeting?.type_code ?? typeCode,
    title: meeting?.title ?? '',
    instructor: meeting?.instructor ?? '',
    location: meeting?.location ?? '',
    weekday: String(meeting?.weekday ?? 1),
    start_time: (meeting?.start_time ?? '09:00').slice(0, 5),
    end_time: (meeting?.end_time ?? '10:00').slice(0, 5),
    recurrence: meeting?.recurrence ?? 'weekly',
    anchor_week: String(meeting?.anchor_week ?? 1),
    start_week: String(meeting?.start_week ?? 1),
    end_week: meeting?.end_week != null ? String(meeting.end_week) : '',
    skip_breaks: meeting?.skip_breaks ?? true,
    enabled: meeting?.enabled ?? true,
  }
}

const int = (value: string) => (value.trim() === '' ? null : Number.parseInt(value, 10))

/**
 * Add or edit a recurring meeting of a course (M04 §5.3). `initial` prefills a new meeting (for
 * example from the calendar); `meeting` edits an existing one.
 */
export function MeetingDialog({
  programId,
  courseId,
  termIds,
  termId,
  meeting,
  initial,
  open,
  onOpenChange,
}: {
  programId: string
  courseId: string
  /** The course's terms; the term can be changed only among these. */
  termIds: readonly string[]
  termId: string
  meeting?: Meeting
  initial?: Partial<Meeting>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const types = useEventTypes(programId).data?.items ?? []
  const terms = useTerms(programId).data?.items ?? []
  const [draft, setDraft] = useState<Draft>(() =>
    draftOf(meeting ?? initial, termId, types[0]?.code ?? 'LEC'),
  )
  const [touched, setTouched] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const done = async () => {
    await invalidateSchedule(queryClient)
    onOpenChange(false)
  }
  const create = useMutation({
    ...scheduleMeetingCreateMutation(),
    onError: toastError,
    onSuccess: done,
  })
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
  const pending = create.isPending || update.isPending

  const timeInvalid = draft.start_time >= draft.end_time
  const startWeek = int(draft.start_week)
  const endWeek = int(draft.end_week)
  const weeksInvalid =
    startWeek === null || startWeek < 1 || (endWeek !== null && endWeek < startWeek)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (timeInvalid || weeksInvalid) return
    const body: MeetingCreateInputBody = {
      term_id: draft.term_id,
      section_code: draft.section_code.trim(),
      type_code: draft.type_code,
      title: draft.title.trim() || null,
      instructor: draft.instructor.trim() || null,
      location: draft.location.trim() || null,
      weekday: Number(draft.weekday),
      start_time: draft.start_time,
      end_time: draft.end_time,
      recurrence: draft.recurrence,
      anchor_week: draft.recurrence === 'biweekly' ? (int(draft.anchor_week) ?? 1) : null,
      start_week: startWeek ?? 1,
      end_week: endWeek,
      skip_breaks: draft.skip_breaks,
      enabled: draft.enabled,
    }
    if (meeting) update.mutate({ path: { meeting_id: meeting.id }, body })
    else create.mutate({ path: { course_id: courseId }, body })
  }

  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: weekdayName(d) }))
  const typeOptions = types.map((t) => ({ value: t.code, label: `${t.code} · ${typeName(t)}` }))
  if (!typeOptions.some((o) => o.value === draft.type_code)) {
    typeOptions.push({ value: draft.type_code, label: draft.type_code })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent closeLabel={m.common_close()} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {meeting ? m.schedule_meeting_edit() : m.schedule_meeting_add()}
          </DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="grid grid-cols-2 gap-4">
          {termIds.length > 1 ? (
            <Field label={m.schedule_term()} className="col-span-2">
              <SimpleSelect
                value={draft.term_id}
                onChange={(v) => set('term_id', v)}
                options={termIds.map((id) => ({
                  value: id,
                  label: terms.find((t) => t.id === id)?.name ?? id,
                }))}
              />
            </Field>
          ) : null}
          <Field label={m.schedule_type()}>
            <SimpleSelect
              value={draft.type_code}
              onChange={(v) => set('type_code', v)}
              options={typeOptions}
            />
          </Field>
          <Field label={m.schedule_section_code()}>
            <Input
              placeholder="LEC0101"
              value={draft.section_code}
              onChange={(e) => set('section_code', e.target.value)}
            />
          </Field>
          <Field label={m.schedule_weekday()}>
            <SimpleSelect
              value={draft.weekday}
              onChange={(v) => set('weekday', v)}
              options={weekdays}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={m.schedule_start_time()}>
              <Input
                type="time"
                value={draft.start_time}
                onChange={(e) => set('start_time', e.target.value)}
              />
            </Field>
            <Field
              label={m.schedule_end_time()}
              error={touched && timeInvalid ? m.error_schedule_time_range_invalid() : null}
            >
              <Input
                type="time"
                value={draft.end_time}
                onChange={(e) => set('end_time', e.target.value)}
              />
            </Field>
          </div>
          <Field label={m.schedule_location()}>
            <Input value={draft.location} onChange={(e) => set('location', e.target.value)} />
          </Field>
          <Field label={m.schedule_instructor()}>
            <Input value={draft.instructor} onChange={(e) => set('instructor', e.target.value)} />
          </Field>
          <Field label={m.schedule_meeting_title()} className="col-span-2">
            <Input
              placeholder={m.schedule_meeting_title_placeholder()}
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>
          <div className="col-span-2 flex flex-wrap items-end gap-4">
            <div>
              <p className="mb-2 text-sm font-medium">{m.schedule_recurrence()}</p>
              <SegmentedControl
                aria-label={m.schedule_recurrence()}
                value={draft.recurrence}
                onValueChange={(v) => set('recurrence', v)}
                options={[
                  { value: 'weekly', label: m.schedule_recurrence_weekly() },
                  { value: 'biweekly', label: m.schedule_recurrence_biweekly() },
                ]}
              />
            </div>
            {draft.recurrence === 'biweekly' ? (
              <Field label={m.schedule_anchor_week()} className="w-28">
                <Input
                  type="number"
                  min={1}
                  value={draft.anchor_week}
                  onChange={(e) => set('anchor_week', e.target.value)}
                />
              </Field>
            ) : null}
            <Field label={m.schedule_start_week()} className="w-24">
              <Input
                type="number"
                min={1}
                value={draft.start_week}
                onChange={(e) => set('start_week', e.target.value)}
              />
            </Field>
            <Field
              label={m.schedule_end_week()}
              className="w-24"
              error={touched && weeksInvalid ? m.error_schedule_week_range_invalid() : null}
            >
              <Input
                type="number"
                min={1}
                placeholder={m.schedule_end_week_placeholder()}
                value={draft.end_week}
                onChange={(e) => set('end_week', e.target.value)}
              />
            </Field>
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.skip_breaks}
              onCheckedChange={(checked) => set('skip_breaks', checked)}
            />
            {m.schedule_skip_breaks()}
          </label>
          <DialogFooter className="col-span-2">
            {meeting ? (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-destructive"
                onClick={() => setDeleting(true)}
              >
                {m.schedule_meeting_delete()}
              </Button>
            ) : null}
            <Button type="submit" disabled={pending}>
              {pending ? m.common_saving() : m.common_save()}
            </Button>
          </DialogFooter>
        </form>
        {meeting ? (
          <ConfirmDialog
            open={deleting}
            onOpenChange={setDeleting}
            title={m.schedule_meeting_delete_title()}
            description={m.schedule_meeting_delete_description()}
            confirmLabel={m.schedule_meeting_delete()}
            pending={remove.isPending}
            onConfirm={() => remove.mutate({ path: { meeting_id: meeting.id } })}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
