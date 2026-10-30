import type { CourseFields, TermCreateResult } from '@semestra/api-client'
import { academicsTermCreateMutation } from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useBlocker, useRouter } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { SettingRow, SettingsBlock, SettingsGroup } from '@/app/settings'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
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
import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { Switch } from '@/ui/switch'
import { BreaksTable, completeBreaks } from '../components/BreaksTable'
import { DateRangeField } from '../components/DateRangeField'
import { termPath, termsAndCoursesPath } from '../paths'
import { invalidateAcademics, useCourses, useProgram, useTerms } from '../queries'
import { runImportCallbacks, useCourseSources } from '../add-courses'
import { CourseRowsEditor } from './CourseRowsEditor'
import {
  type WizardDraft,
  clearDraft,
  continuationCandidates,
  courseFields,
  filledRows,
  isDirty,
  loadDraft,
  rowsInvalid,
  saveDraft,
  suggestTermName,
} from './draft'

const STEPS = [m.academics_wizard_step_basics, m.academics_wizard_step_courses]

function basicsProblems(draft: WizardDraft) {
  return {
    name: draft.name.trim() ? null : m.academics_required(),
    dates: draft.start && draft.end ? null : m.academics_required(),
    breaks: breaksProblem(draft),
  }
}

/** The checks `academics.term.create` makes on breaks, shown before the last step. */
function breaksProblem(draft: WizardDraft): string | null {
  const breaks = completeBreaks(draft.breaks).toSorted((a, b) =>
    a.start_date.localeCompare(b.start_date),
  )
  if (draft.start && draft.end) {
    const outside = breaks.some((b) => b.start_date < draft.start || b.end_date > draft.end)
    if (outside) return m.error_academics_break_out_of_range()
  }
  const overlaps = breaks.some((b, i) => {
    const prev = breaks[i - 1]
    return prev !== undefined && b.start_date <= prev.end_date
  })
  return overlaps ? m.error_academics_breaks_overlap() : null
}

/**
 * Creating a term (M02 §5.6): the term (dates, name, breaks) → its courses (typed, imported or
 * continued), then a single `academics.term.create` from the second step; the button is the
 * confirmation (M00 §4.8). The draft lives in sessionStorage until it is created or discarded.
 */
export function TermWizard({
  programId,
  onCreated,
  onSkip,
}: {
  programId: string
  /** Default: open the new term. Onboarding passes its own and has no "Cancel". */
  onCreated?: (result: TermCreateResult) => void
  /** Onboarding: "Add later" in place of "Cancel", leaving the Program without a term. */
  onSkip?: () => void
}) {
  const id = useId()
  const router = useRouter()
  const queryClient = useQueryClient()
  const program = useProgram(programId).data
  const terms = useTerms(programId).data?.items ?? []
  const courses = useCourses(programId).data?.items ?? []
  const sources = useCourseSources(programId)
  const [draft, setDraft] = useState<WizardDraft>(() => loadDraft(programId))
  const [touched, setTouched] = useState(false)
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

  // A draft saved by the three-step wizard may still be on its last step.
  const step = Math.min(draft.step, STEPS.length - 1)
  const candidates = continuationCandidates(terms, courses, draft.start)
  const continueIds = candidates.filter((c) => !draft.skipContinue.includes(c.id)).map((c) => c.id)
  const filled = filledRows(draft.rows)
  const problems = basicsProblems(draft)
  const defaultCredits = program?.default_course_credits ?? 0.5
  const datesError = touched ? problems.dates : null
  const nameError = touched ? problems.name : null
  const breaks = completeBreaks(draft.breaks)

  const create = useMutation({
    ...academicsTermCreateMutation(),
    onError: toastError,
    onSuccess: async (result) => {
      done.current = true
      clearDraft(programId)
      await runImportCallbacks(sources, draft.rows, result.course_ids)
      await invalidateAcademics(queryClient)
      if (onCreated) onCreated(result)
      else router.history.push(termPath(programId, result.term.id))
    },
  })

  const submit = () => {
    if (rowsInvalid(draft.rows)) {
      setTouched(true)
      return
    }
    const body: CourseFields[] = filled.map(courseFields)
    create.mutate({
      path: { program_id: programId },
      body: {
        name: draft.name.trim(),
        start_date: draft.start,
        end_date: draft.end,
        breaks,
        count_break_weeks: draft.countBreakWeeks,
        courses: body,
        continue_course_ids: continueIds,
      },
    })
  }

  const next = () => {
    setTouched(true)
    if (problems.name || problems.dates || problems.breaks) return
    setTouched(false)
    patch({ step: 1 })
  }

  const summary = [
    draft.name.trim(),
    m.academics_wizard_summary_courses({ count: filled.length }),
    ...(continueIds.length > 0
      ? [m.academics_wizard_summary_continuing({ count: continueIds.length })]
      : []),
  ].join(' · ')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ol className="flex items-center gap-2 text-sm" aria-label={m.academics_wizard_steps()}>
        {STEPS.map((title, index) => (
          <li
            key={title()}
            className="flex items-center gap-2"
            aria-current={index === step ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-xs',
                index < step
                  ? 'bg-primary text-primary-foreground'
                  : index === step
                    ? 'border-2 border-primary font-medium text-primary'
                    : 'border border-border text-muted-foreground',
              )}
            >
              {index < step ? <Check aria-hidden className="size-3.5" /> : index + 1}
            </span>
            <span className={index === step ? 'font-medium' : 'text-muted-foreground'}>
              {title()}
            </span>
            {index < STEPS.length - 1 ? (
              <span aria-hidden className="mx-1 h-px w-8 bg-border" />
            ) : null}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <section className="space-y-6">
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field data-invalid={datesError ? true : undefined}>
              <FieldLabel htmlFor={`${id}-dates`}>{m.academics_term_dates()}</FieldLabel>
              <DateRangeField
                id={`${id}-dates`}
                className="w-full"
                start={draft.start}
                end={draft.end}
                weeks
                holidays={breaks.map((b) => ({ start: b.start_date, end: b.end_date }))}
                placeholder={m.academics_term_dates_placeholder()}
                invalid={Boolean(datesError)}
                describedBy={datesError ? `${id}-dates-error` : undefined}
                onChange={setDates}
              />
              {datesError ? <FieldError id={`${id}-dates-error`}>{datesError}</FieldError> : null}
            </Field>
            <Field data-invalid={nameError ? true : undefined}>
              <FieldLabel htmlFor={`${id}-name`}>{m.academics_term_name()}</FieldLabel>
              <Input
                id={`${id}-name`}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={
                  nameError
                    ? `${id}-name-error`
                    : draft.nameEdited || !draft.start
                      ? undefined
                      : `${id}-name-hint`
                }
                placeholder={draft.start ? undefined : m.academics_term_name_after_dates()}
                value={draft.name}
                onChange={(event) => patch({ name: event.target.value, nameEdited: true })}
              />
              {nameError ? (
                <FieldError id={`${id}-name-error`}>{nameError}</FieldError>
              ) : draft.nameEdited || !draft.start ? null : (
                <FieldDescription id={`${id}-name-hint`}>
                  {m.academics_term_name_suggested()}
                </FieldDescription>
              )}
            </Field>
          </div>
          <SettingsBlock title={m.academics_term_breaks()}>
            <BreaksTable
              value={draft.breaks}
              onChange={(value) => patch({ breaks: value })}
              min={draft.start || undefined}
              max={draft.end || undefined}
            />
            {problems.breaks ? <FieldError>{problems.breaks}</FieldError> : null}
          </SettingsBlock>
          <SettingsGroup>
            <SettingRow
              label={m.academics_term_count_break_weeks()}
              description={m.academics_term_count_break_weeks_hint()}
            >
              {(labelId) => (
                <Switch
                  aria-labelledby={labelId}
                  checked={draft.countBreakWeeks}
                  onCheckedChange={(on) => patch({ countBreakWeeks: on })}
                />
              )}
            </SettingRow>
          </SettingsGroup>
        </section>
      ) : null}

      {step === 1 ? (
        <CourseRowsEditor
          programId={programId}
          heading={
            <h2 className="font-heading text-lg font-medium">
              {m.academics_wizard_courses_title()}
            </h2>
          }
          sources={sources}
          rows={draft.rows}
          continuing={candidates.map((course) => ({
            course,
            kept: !draft.skipContinue.includes(course.id),
          }))}
          touched={touched}
          defaultCredits={defaultCredits}
          startDate={draft.start || undefined}
          endDate={draft.end || undefined}
          onRowsChange={(update) =>
            setDraft((current) => ({ ...current, rows: update(current.rows) }))
          }
          onContinue={(courseId, kept) =>
            patch({
              skipContinue: kept
                ? draft.skipContinue.filter((cid) => cid !== courseId)
                : [...draft.skipContinue, courseId],
            })
          }
        />
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        {step === 0 ? (
          onSkip ? (
            <Button variant="ghost" onClick={onSkip}>
              {m.academics_onboarding_term_later()}
            </Button>
          ) : onCreated ? (
            <span />
          ) : (
            <Button
              variant="ghost"
              onClick={() => router.history.push(termsAndCoursesPath(programId))}
            >
              {m.common_cancel()}
            </Button>
          )
        ) : (
          <Button variant="ghost" disabled={create.isPending} onClick={() => patch({ step: 0 })}>
            {m.academics_wizard_back()}
          </Button>
        )}
        {step === 0 ? (
          <Button onClick={next}>{m.academics_wizard_next()}</Button>
        ) : (
          <div className="flex min-w-0 items-center gap-4">
            <span className="truncate text-sm text-muted-foreground">{summary}</span>
            <Button onClick={submit} disabled={create.isPending}>
              {create.isPending ? m.common_saving() : m.academics_wizard_create()}
            </Button>
          </div>
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
              variant="destructive"
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
