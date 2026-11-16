import type { ItemOut } from '@semestra/api-client'
import { filesItemSetWeekMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarDays } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { errorMessage } from '@/lib/errors'
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
import { Field, FieldError, FieldGroup, FieldLabel } from '@/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { invalidateFiles } from '../queries'
import {
  type CourseWeeks,
  type WeekFilter,
  type WeekOption,
  useCourseWeeks,
  weekDates,
  weekLabel,
} from '../weeks'

const TERM = 'term'

/** Every choice's text, for the closed select to show. */
function labels(weeks: CourseWeeks, all: boolean) {
  return [
    ...(all ? [{ value: 'all', label: m.files_week_all() }] : []),
    { value: TERM, label: m.files_week_term() },
    ...weeks.terms.flatMap((t) => t.weeks.map((w) => ({ value: w.start, label: weekLabel(w) }))),
  ]
}

function WeekItem({ week }: { week: WeekOption }) {
  return (
    <SelectItem value={week.start}>
      <span className="flex w-full items-baseline justify-between gap-6">
        <span>{weekLabel(week)}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{weekDates(week)}</span>
      </span>
    </SelectItem>
  )
}

/** The whole term, then each week; grouped by term when the course has more than one. */
function WeekItems({ weeks, all }: { weeks: CourseWeeks; all: boolean }) {
  const grouped = weeks.terms.length > 1
  return (
    <>
      <SelectGroup>
        {all ? <SelectItem value="all">{m.files_week_all()}</SelectItem> : null}
        <SelectItem value={TERM}>{m.files_week_term()}</SelectItem>
      </SelectGroup>
      {weeks.terms.map((term) => (
        <SelectGroup key={term.termId}>
          <SelectSeparator />
          {grouped ? <SelectLabel>{term.name}</SelectLabel> : null}
          {term.weeks.map((week) => (
            <WeekItem key={week.start} week={week} />
          ))}
        </SelectGroup>
      ))}
    </>
  )
}

/** The files page's week filter: every file, the whole term's, or one week's. */
export function WeekFilterSelect({
  weeks,
  value,
  onChange,
}: {
  weeks: CourseWeeks
  value: WeekFilter
  onChange: (next: WeekFilter) => void
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next ?? 'all')}
      items={labels(weeks, true)}
    >
      <SelectTrigger aria-label={m.files_week()} className="w-auto min-w-36">
        <CalendarDays aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        className="w-auto min-w-(--anchor-width)"
      >
        <WeekItems weeks={weeks} all />
      </SelectContent>
    </Select>
  )
}

/** "Change week…": one week (or the whole term) for the chosen files; the rules leave it there. */
export function WeekDialog({
  courseId,
  items,
  open,
  onOpenChangeComplete,
  onClose,
  onDone,
}: {
  courseId: string
  items: readonly ItemOut[]
  open: boolean
  onOpenChangeComplete?: (open: boolean) => void
  onClose: () => void
  onDone?: () => void
}) {
  const id = useId()
  const queryClient = useQueryClient()
  const weeks = useCourseWeeks(courseId)
  // Preset when they share a week.
  const shared = new Set(items.map((i) => i.week ?? TERM))
  const [value, setValue] = useState<string | null>(
    shared.size === 1 ? (items[0]?.week ?? TERM) : null,
  )
  const save = useMutation({
    ...filesItemSetWeekMutation(),
    onSuccess: () => invalidateFiles(queryClient, courseId),
  })
  const shown = weeks && value !== null && value !== TERM ? weeks.find(value)?.start : value
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (value === null) return
    save.mutate(
      {
        path: { course_id: courseId },
        body: { item_ids: items.map((i) => i.id), week: value === TERM ? null : value },
      },
      {
        onSuccess: () => {
          onDone?.()
          onClose()
        },
      },
    )
  }
  return (
    <Dialog
      open={open}
      onOpenChangeComplete={onOpenChangeComplete}
      onOpenChange={(next) => !next && !save.isPending && onClose()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {items.length === 1
              ? m.files_week_change_one({ name: items[0]?.display_name ?? '' })
              : m.files_week_change_many({ count: items.length })}
          </DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit}>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor={`${id}-week`}>{m.files_week()}</FieldLabel>
              <Select
                value={shown ?? null}
                onValueChange={setValue}
                items={weeks ? labels(weeks, false) : []}
              >
                <SelectTrigger id={`${id}-week`} className="w-full" disabled={!weeks}>
                  <SelectValue placeholder={m.files_week_pick()} />
                </SelectTrigger>
                <SelectContent>
                  {weeks ? <WeekItems weeks={weeks} all={false} /> : null}
                </SelectContent>
              </Select>
            </Field>
            {save.error ? <FieldError>{errorMessage(save.error)}</FieldError> : null}
            <DialogFooter>
              <DialogClose
                render={<Button type="button" variant="outline" disabled={save.isPending} />}
              >
                {m.common_cancel()}
              </DialogClose>
              <Button type="submit" disabled={save.isPending || value === null}>
                {save.isPending ? m.common_saving() : m.common_save()}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}
