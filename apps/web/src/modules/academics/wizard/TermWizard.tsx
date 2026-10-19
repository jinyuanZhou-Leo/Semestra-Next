import type { CourseFields, TermCreateResult } from '@semestra/api-client'
import { academicsTermCreateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { useBlocker, useRouter } from '@tanstack/react-router'
import { Check, ChevronDownIcon, Import, Plus, Repeat, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useExtensions } from '@/app/registry'
import { errorMessage, toastError } from '@/lib/errors'
import { formatCredits, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Calendar } from '@/ui/calendar'
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from '@/ui/field'
import { Input } from '@/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Switch } from '@/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { courseLabel } from '../color'
import { BreaksEditor, completeBreaks } from '../components/BreaksEditor'
import { termPath } from '../paths'
import { invalidateAcademics, useCourses, useProgram, useTerms } from '../queries'
import { TERM_WIZARD_IMPORT_SOURCES, type TermWizardImportSource } from '../types'
import {
  type DraftRow,
  type WizardDraft,
  clearDraft,
  continuationCandidates,
  isDirty,
  loadDraft,
  newRowKey,
  saveDraft,
  suggestTermName,
} from './draft'

const STEPS = [
  m.academics_wizard_step_basics,
  m.academics_wizard_step_courses,
  m.academics_wizard_step_confirm,
]

const day = (iso: string) => formatDate(`${iso}T00:00`)

function rowIsEmpty(row: DraftRow) {
  return !row.code.trim() && !row.title.trim() && !row.credits.trim()
}

function creditsProblem(text: string): boolean {
  if (text.trim() === '') return false
  const n = Number(text)
  return !(n >= 0 && n <= 100)
}

function basicsProblems(draft: WizardDraft) {
  return {
    name: draft.name.trim() ? null : m.academics_required(),
    start: draft.start ? null : m.academics_required(),
    end: !draft.end
      ? m.academics_required()
      : draft.start && draft.end < draft.start
        ? m.error_academics_term_date_range_invalid()
        : null,
  }
}

/**
 * Creating a term (M02 §5.6): basics → courses (typed, imported or continued) → confirm, then a
 * single `academics.term.create`. The draft lives in sessionStorage until it is created or
 * discarded.
 */
export function TermWizard({
  programId,
  onCreated,
}: {
  programId: string
  /** Default: open the new term. */
  onCreated?: (result: TermCreateResult) => void
}) {
  const id = useId()
  const router = useRouter()
  const queryClient = useQueryClient()
  const program = useProgram(programId).data
  const terms = useTerms(programId).data?.items ?? []
  const courses = useCourses(programId).data?.items ?? []
  const sources = useExtensions<TermWizardImportSource>(TERM_WIZARD_IMPORT_SOURCES)
  useQueries({ queries: sources.flatMap((s) => (s.query ? [s.query(programId)] : [])) })
  const [draft, setDraft] = useState<WizardDraft>(() => loadDraft(programId))
  const [touched, setTouched] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const done = useRef(false)

  useEffect(() => {
    if (!done.current) saveDraft(programId, draft)
  }, [programId, draft])

  const blocker = useBlocker({
    shouldBlockFn: () => !done.current && isDirty(draft),
    enableBeforeUnload: false,
    withResolver: true,
  })

  const patch = (next: Partial<WizardDraft>) => setDraft((current) => ({ ...current, ...next }))
  const setDates = (start: string, end: string) =>
    patch({ start, end, ...(draft.nameEdited ? {} : { name: suggestTermName(start) }) })

  const candidates = continuationCandidates(terms, courses, draft.start)
  const continueIds = candidates.filter((c) => !draft.skipContinue.includes(c.id)).map((c) => c.id)
  const filledRows = draft.rows.filter((row) => !rowIsEmpty(row))
  const problems = basicsProblems(draft)
  const rowsInvalid = filledRows.some((row) => !row.title.trim() || creditsProblem(row.credits))
  const defaultCredits = program?.default_course_credits ?? 0.5
  const startError = touched ? problems.start : null
  const endError = touched ? problems.end : null
  const nameError = touched ? problems.name : null

  const create = useMutation({
    ...academicsTermCreateMutation(),
    onError: toastError,
    onSuccess: async (result) => {
      done.current = true
      clearDraft(programId)
      await runImportCallbacks(result.course_ids)
      await invalidateAcademics(queryClient)
      if (onCreated) onCreated(result)
      else router.history.push(termPath(programId, result.term.id))
    },
  })

  async function runImportCallbacks(courseIds: string[]) {
    for (const source of sources) {
      if (!source.onCoursesCreated) continue
      const mapping = filledRows.flatMap((row, index) => {
        const courseId = courseIds[index]
        return row.sourceId === source.id && row.draft?.extras && courseId
          ? [{ draft: row.draft, courseId }]
          : []
      })
      if (mapping.length === 0) continue
      try {
        await source.onCoursesCreated(mapping)
      } catch (error) {
        toastError(error)
      }
    }
  }

  const submit = () => {
    const body: CourseFields[] = filledRows.map((row) => ({
      code: row.code.trim() || null,
      title: row.title.trim(),
      credits: row.credits.trim() === '' ? null : Number(row.credits),
      planned_terms: row.yearLong ? 2 : 1,
      instructors: row.draft?.instructors ?? [],
      description: row.draft?.description ?? null,
    }))
    create.mutate({
      path: { program_id: programId },
      body: {
        name: draft.name.trim(),
        start_date: draft.start,
        end_date: draft.end,
        breaks: completeBreaks(draft.breaks),
        count_break_weeks: draft.countBreakWeeks,
        courses: body,
        continue_course_ids: continueIds,
      },
    })
  }

  const next = () => {
    if (draft.step === 0) {
      setTouched(true)
      if (problems.name || problems.start || problems.end) return
    }
    if (draft.step === 1 && rowsInvalid) {
      setTouched(true)
      return
    }
    setTouched(false)
    patch({ step: draft.step + 1 })
  }

  const launch = async (source: TermWizardImportSource) => {
    setImporting(source.id)
    const startDate = draft.start || undefined
    const endDate = draft.end || undefined
    try {
      const drafts = await source.launch({ programId, startDate, endDate })
      setDraft((current) => ({
        ...current,
        rows: [
          ...current.rows.filter((row) => !rowIsEmpty(row)),
          ...drafts.map((d) => ({
            key: newRowKey(),
            code: d.code ?? '',
            title: d.title,
            credits: d.credits == null ? '' : String(d.credits),
            yearLong: (d.plannedTerms ?? 1) > 1,
            sourceId: source.id,
            draft: d,
          })),
        ],
      }))
    } catch (error) {
      toastError(error)
    }
    setImporting(null)
  }

  const updateRow = (key: string, change: Partial<DraftRow>) =>
    patch({ rows: draft.rows.map((row) => (row.key === key ? { ...row, ...change } : row)) })
  const addRow = () =>
    patch({
      rows: [
        ...draft.rows,
        { key: newRowKey(), code: '', title: '', credits: '', yearLong: false },
      ],
    })

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ol className="flex items-center gap-2 text-sm" aria-label={m.academics_wizard_steps()}>
        {STEPS.map((title, index) => (
          <li
            key={title()}
            className="flex items-center gap-2"
            aria-current={index === draft.step ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-xs',
                index < draft.step
                  ? 'bg-primary text-primary-foreground'
                  : index === draft.step
                    ? 'border-2 border-primary font-medium text-primary'
                    : 'border border-border text-muted-foreground',
              )}
            >
              {index < draft.step ? <Check aria-hidden className="size-3.5" /> : index + 1}
            </span>
            <span className={index === draft.step ? 'font-medium' : 'text-muted-foreground'}>
              {title()}
            </span>
            {index < STEPS.length - 1 ? (
              <span aria-hidden className="mx-1 h-px w-8 bg-border" />
            ) : null}
          </li>
        ))}
      </ol>

      {draft.step === 0 ? (
        <section className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={startError ? true : undefined}>
              <FieldLabel htmlFor={`${id}-start`}>{m.academics_term_start()}</FieldLabel>
              <IsoDateField
                id={`${id}-start`}
                value={draft.start}
                invalid={Boolean(startError)}
                describedBy={startError ? `${id}-start-error` : undefined}
                onChange={(start) => setDates(start, draft.end)}
              />
              {startError ? <FieldError id={`${id}-start-error`}>{startError}</FieldError> : null}
            </Field>
            <Field data-invalid={endError ? true : undefined}>
              <FieldLabel htmlFor={`${id}-end`}>{m.academics_term_end()}</FieldLabel>
              <IsoDateField
                id={`${id}-end`}
                value={draft.end}
                min={draft.start || undefined}
                invalid={Boolean(endError)}
                describedBy={endError ? `${id}-end-error` : undefined}
                onChange={(end) => setDates(draft.start, end)}
              />
              {endError ? <FieldError id={`${id}-end-error`}>{endError}</FieldError> : null}
            </Field>
          </div>
          <Field data-invalid={nameError ? true : undefined}>
            <FieldLabel htmlFor={`${id}-name`}>{m.academics_term_name()}</FieldLabel>
            <Input
              id={`${id}-name`}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={
                nameError ? `${id}-name-error` : draft.nameEdited ? undefined : `${id}-name-hint`
              }
              placeholder={m.academics_term_name_placeholder()}
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value, nameEdited: true })}
            />
            {nameError ? (
              <FieldError id={`${id}-name-error`}>{nameError}</FieldError>
            ) : draft.nameEdited ? null : (
              <FieldDescription id={`${id}-name-hint`}>
                {m.academics_term_name_suggested()}
              </FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel>{m.academics_term_breaks()}</FieldLabel>
            <BreaksEditor
              value={draft.breaks}
              onChange={(breaks) => patch({ breaks })}
              min={draft.start || undefined}
              max={draft.end || undefined}
            />
          </Field>
          <Field orientation="horizontal">
            <Switch
              id={`${id}-count-break-weeks`}
              checked={draft.countBreakWeeks}
              onCheckedChange={(on) => patch({ countBreakWeeks: on })}
            />
            <FieldLabel htmlFor={`${id}-count-break-weeks`} className="font-normal">
              {m.academics_term_count_break_weeks()}
            </FieldLabel>
          </Field>
        </section>
      ) : null}

      {draft.step === 1 ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-heading text-lg font-medium">
              {m.academics_wizard_courses_title()}
            </h2>
            {sources.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="sm" disabled={importing !== null} />}
                >
                  <Import aria-hidden />
                  {importing ? m.common_loading() : m.academics_wizard_import()}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  {sources.map((source) => (
                    <DropdownMenuItem key={source.id} onClick={() => void launch(source)}>
                      <source.icon aria-hidden />
                      <span className="min-w-0">
                        <span className="block">
                          {source.Title ? <source.Title programId={programId} /> : source.title()}
                        </span>
                        {source.description ? (
                          <span className="block text-xs text-muted-foreground">
                            {source.description()}
                          </span>
                        ) : null}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>

          {candidates.length > 0 ? (
            <FieldSet className="gap-2 rounded-2xl border border-border p-4">
              <FieldLegend variant="label" className="mb-0 flex items-center gap-2 px-1">
                <Repeat aria-hidden className="size-4" />
                {m.academics_wizard_continue_title()}
              </FieldLegend>
              <FieldDescription className="text-xs">
                {m.academics_wizard_continue_hint()}
              </FieldDescription>
              {candidates.map((course) => (
                <Field key={course.id} orientation="horizontal">
                  <Checkbox
                    id={`${id}-continue-${course.id}`}
                    checked={!draft.skipContinue.includes(course.id)}
                    onCheckedChange={(on) =>
                      patch({
                        skipContinue: on
                          ? draft.skipContinue.filter((cid) => cid !== course.id)
                          : [...draft.skipContinue, course.id],
                      })
                    }
                  />
                  <FieldLabel htmlFor={`${id}-continue-${course.id}`} className="font-normal">
                    <span className="font-medium">{courseLabel(course)}</span>
                    {course.code ? (
                      <span className="text-muted-foreground">{course.title}</span>
                    ) : null}
                  </FieldLabel>
                </Field>
              ))}
            </FieldSet>
          ) : null}

          <div className="overflow-x-auto rounded-2xl border border-border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col" className="h-auto py-2 text-muted-foreground">
                    {m.academics_course_code()}
                  </TableHead>
                  <TableHead scope="col" className="h-auto py-2 text-muted-foreground">
                    {m.academics_course_title()}
                  </TableHead>
                  <TableHead scope="col" className="h-auto py-2 text-muted-foreground">
                    {m.academics_course_credits()}
                  </TableHead>
                  <TableHead scope="col" className="h-auto py-2 text-muted-foreground">
                    {m.academics_course_year_long_short()}
                  </TableHead>
                  <TableHead scope="col" className="h-auto w-10 py-2">
                    <span className="sr-only">{m.common_remove()}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.rows.map((row, index) => {
                  const titleMissing = touched && !rowIsEmpty(row) && !row.title.trim()
                  const creditsBad = touched && creditsProblem(row.credits)
                  return (
                    <TableRow key={row.key} className="hover:bg-transparent">
                      <TableCell className="px-2 py-1.5">
                        <Input
                          aria-label={m.academics_wizard_row_code({ row: index + 1 })}
                          placeholder="APS105H1"
                          className="w-32"
                          value={row.code}
                          onChange={(event) => updateRow(row.key, { code: event.target.value })}
                        />
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        <Input
                          aria-label={m.academics_wizard_row_title({ row: index + 1 })}
                          aria-invalid={titleMissing || undefined}
                          value={row.title}
                          onChange={(event) => updateRow(row.key, { title: event.target.value })}
                        />
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min={0}
                          aria-label={m.academics_wizard_row_credits({ row: index + 1 })}
                          aria-invalid={creditsBad || undefined}
                          placeholder={String(defaultCredits)}
                          className="w-24"
                          value={row.credits}
                          onChange={(event) => updateRow(row.key, { credits: event.target.value })}
                        />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Checkbox
                          aria-label={m.academics_wizard_row_year_long({ row: index + 1 })}
                          checked={row.yearLong}
                          onCheckedChange={(on) => updateRow(row.key, { yearLong: on })}
                        />
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        <Button
                          variant="destructive"
                          size="icon-sm"
                          aria-label={m.academics_wizard_row_remove({ row: index + 1 })}
                          onClick={() =>
                            patch({ rows: draft.rows.filter((r) => r.key !== row.key) })
                          }
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <div className="border-t border-border p-2">
              <Button variant="ghost" size="sm" onClick={addRow}>
                <Plus aria-hidden />
                {m.academics_wizard_add_row()}
              </Button>
            </div>
          </div>
          <FieldError>
            {touched && rowsInvalid ? m.academics_wizard_rows_invalid() : null}
          </FieldError>
        </section>
      ) : null}

      {draft.step === 2 ? (
        <section className="space-y-3 text-sm" aria-labelledby={`${id}-summary`}>
          <h2 id={`${id}-summary`} className="font-heading text-lg font-medium">
            {draft.name}
          </h2>
          <p className="text-muted-foreground">
            {day(draft.start)} – {day(draft.end)}
          </p>
          {completeBreaks(draft.breaks).length > 0 ? (
            <ul className="list-inside list-disc text-muted-foreground">
              {completeBreaks(draft.breaks).map((b) => (
                <li key={`${b.name}:${b.start_date}`}>
                  {b.name}: {day(b.start_date)} – {day(b.end_date)}
                </li>
              ))}
            </ul>
          ) : null}
          <p>{m.academics_wizard_summary_new({ count: filledRows.length })}</p>
          {filledRows.length > 0 ? (
            <ul className="space-y-0.5 text-muted-foreground">
              {filledRows.map((row) => (
                <li key={row.key}>
                  {[row.code, row.title].filter(Boolean).join(' · ')} ·{' '}
                  {formatCredits(row.credits.trim() ? Number(row.credits) : defaultCredits)}
                  {row.yearLong ? ` · ${m.academics_course_year_long()}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {continueIds.length > 0 ? (
            <p>{m.academics_wizard_summary_continued({ count: continueIds.length })}</p>
          ) : null}
          <FieldError>{create.error ? errorMessage(create.error) : null}</FieldError>
        </section>
      ) : null}

      <div className="flex justify-between gap-2 border-t border-border pt-4">
        <Button
          variant="ghost"
          disabled={draft.step === 0 || create.isPending}
          onClick={() => patch({ step: draft.step - 1 })}
        >
          {m.academics_wizard_back()}
        </Button>
        {draft.step < STEPS.length - 1 ? (
          <Button onClick={next}>{m.academics_wizard_next()}</Button>
        ) : (
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? m.common_saving() : m.academics_wizard_create()}
          </Button>
        )}
      </div>

      <AlertDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => !open && blocker.reset?.()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{m.academics_wizard_leave_title()}</AlertDialogTitle>
            <AlertDialogDescription>
              {m.academics_wizard_leave_description()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">{m.academics_wizard_leave_stay()}</AlertDialogCancel>
            <AlertDialogAction
              variant="outline"
              onClick={() => {
                done.current = true
                clearDraft(programId)
                blocker.proceed?.()
              }}
            >
              {m.academics_wizard_leave_discard()}
            </AlertDialogAction>
            <AlertDialogAction onClick={() => blocker.proceed?.()}>
              {m.academics_wizard_leave_keep()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function parseIsoDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const datePart = Number(match[3])
  const date = new Date(year, month - 1, datePart)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== datePart) {
    return undefined
  }
  return date
}

function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const datePart = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${datePart}`
}

function dayNumber(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
}

/** One `yyyy-MM-dd` day, edited with the base-luma date picker. */
function IsoDateField({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  min,
  max,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  describedBy?: string
  min?: string
  max?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = parseIsoDate(value)
  const minDate = min ? parseIsoDate(min) : undefined
  const maxDate = max ? parseIsoDate(max) : undefined
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            id={id}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            data-empty={!selected}
            className="w-full justify-between text-left font-normal data-[empty=true]:text-muted-foreground"
          />
        }
      >
        {value && selected ? formatDate(value) : <span>{m.academics_date_placeholder()}</span>}
        <ChevronDownIcon data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          disabled={
            minDate || maxDate
              ? (date) => {
                  const selectedDay = dayNumber(date)
                  if (minDate && selectedDay < dayNumber(minDate)) return true
                  if (maxDate && selectedDay > dayNumber(maxDate)) return true
                  return false
                }
              : undefined
          }
          onSelect={(next) => {
            onChange(next ? toIsoDate(next) : '')
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
