import type { CourseFields, TermCreateResult } from '@semestra/api-client'
import { academicsTermCreateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useBlocker, useRouter } from '@tanstack/react-router'
import { Check, Import, Plus, Repeat, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useExtensions } from '@/app/registry'
import { TextField } from '@/components/TextField'
import { errorMessage, toastError } from '@/lib/errors'
import { formatCredits, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import {
  AlertDialog,
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
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { Switch } from '@/ui/switch'
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
    try {
      const drafts = await source.launch({
        programId,
        startDate: draft.start || undefined,
        endDate: draft.end || undefined,
      })
      setDraft((current) => ({
        ...current,
        rows: [
          ...current.rows.filter((row) => !rowIsEmpty(row)),
          ...drafts.map((d) => ({
            key: newRowKey(),
            code: d.code ?? '',
            title: d.title,
            credits: d.credits == null ? '' : String(d.credits),
            yearLong: false,
            sourceId: source.id,
            draft: d,
          })),
        ],
      }))
    } catch (error) {
      toastError(error)
    } finally {
      setImporting(null)
    }
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
            <TextField
              label={m.academics_term_start()}
              type="date"
              value={draft.start}
              onChange={(event) => setDates(event.target.value, draft.end)}
              error={touched ? problems.start : null}
            />
            <TextField
              label={m.academics_term_end()}
              type="date"
              min={draft.start || undefined}
              value={draft.end}
              onChange={(event) => setDates(draft.start, event.target.value)}
              error={touched ? problems.end : null}
            />
          </div>
          <TextField
            label={m.academics_term_name()}
            placeholder={m.academics_term_name_placeholder()}
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value, nameEdited: true })}
            error={touched ? problems.name : null}
            hint={draft.nameEdited ? null : m.academics_term_name_suggested()}
          />
          <div className="space-y-2">
            <Label>{m.academics_term_breaks()}</Label>
            <BreaksEditor
              value={draft.breaks}
              onChange={(breaks) => patch({ breaks })}
              min={draft.start || undefined}
              max={draft.end || undefined}
            />
          </div>
          <label className="flex items-center gap-3 text-sm">
            <Switch
              checked={draft.countBreakWeeks}
              onCheckedChange={(on) => patch({ countBreakWeeks: on })}
            />
            {m.academics_term_count_break_weeks()}
          </label>
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
                        <span className="block">{source.title()}</span>
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
            <fieldset className="space-y-2 rounded-2xl border border-border p-4">
              <legend className="flex items-center gap-2 px-1 text-sm font-medium">
                <Repeat aria-hidden className="size-4" />
                {m.academics_wizard_continue_title()}
              </legend>
              <p className="text-xs text-muted-foreground">{m.academics_wizard_continue_hint()}</p>
              {candidates.map((course) => (
                <label key={course.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={!draft.skipContinue.includes(course.id)}
                    onCheckedChange={(on) =>
                      patch({
                        skipContinue: on
                          ? draft.skipContinue.filter((cid) => cid !== course.id)
                          : [...draft.skipContinue, course.id],
                      })
                    }
                  />
                  <span className="font-medium">{courseLabel(course)}</span>
                  {course.code ? (
                    <span className="text-muted-foreground">{course.title}</span>
                  ) : null}
                </label>
              ))}
            </fieldset>
          ) : null}

          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {m.academics_course_code()}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {m.academics_course_title()}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {m.academics_course_credits()}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {m.academics_course_year_long_short()}
                  </th>
                  <th scope="col" className="w-10 px-3 py-2">
                    <span className="sr-only">{m.common_remove()}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.rows.map((row, index) => {
                  const titleMissing = touched && !rowIsEmpty(row) && !row.title.trim()
                  const creditsBad = touched && creditsProblem(row.credits)
                  return (
                    <tr key={row.key} className="border-t border-border">
                      <td className="px-2 py-1.5">
                        <Input
                          aria-label={m.academics_wizard_row_code({ row: index + 1 })}
                          placeholder="APS105H1"
                          className="w-32"
                          value={row.code}
                          onChange={(event) => updateRow(row.key, { code: event.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          aria-label={m.academics_wizard_row_title({ row: index + 1 })}
                          aria-invalid={titleMissing || undefined}
                          value={row.title}
                          onChange={(event) => updateRow(row.key, { title: event.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
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
                      </td>
                      <td className="px-3 py-1.5">
                        <Checkbox
                          aria-label={m.academics_wizard_row_year_long({ row: index + 1 })}
                          checked={row.yearLong}
                          onCheckedChange={(on) => updateRow(row.key, { yearLong: on })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={m.academics_wizard_row_remove({ row: index + 1 })}
                          onClick={() =>
                            patch({ rows: draft.rows.filter((r) => r.key !== row.key) })
                          }
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="border-t border-border p-2">
              <Button variant="ghost" size="sm" onClick={addRow}>
                <Plus aria-hidden />
                {m.academics_wizard_add_row()}
              </Button>
            </div>
          </div>
          {touched && rowsInvalid ? (
            <p role="alert" className="text-sm text-destructive">
              {m.academics_wizard_rows_invalid()}
            </p>
          ) : null}
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
          {create.error ? (
            <p role="alert" className="text-destructive">
              {errorMessage(create.error)}
            </p>
          ) : null}
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
            <Button variant="ghost" onClick={() => blocker.reset?.()}>
              {m.academics_wizard_leave_stay()}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                done.current = true
                clearDraft(programId)
                blocker.proceed?.()
              }}
            >
              {m.academics_wizard_leave_discard()}
            </Button>
            <Button onClick={() => blocker.proceed?.()}>{m.academics_wizard_leave_keep()}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
