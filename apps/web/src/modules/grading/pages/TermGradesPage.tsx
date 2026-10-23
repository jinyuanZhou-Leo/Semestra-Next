import type { CourseGrade, TermGrades } from '@semestra/api-client'
import { gradingSimulateTermMutation } from '@semestra/api-client/react-query'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { useMutation } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useId } from 'react'
import type { PageProps } from '@/app/extensions'
import { useUiPref } from '@/app/ui-pref'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { HistoryLink } from '@/components/HistoryLink'
import { toastError } from '@/lib/errors'
import { formatCredits, formatGpa } from '@/lib/format'
import { omitKey } from '@/lib/omit'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { BookOpen } from 'lucide-react'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Field, FieldLabel } from '@/ui/field'
import { Switch } from '@/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { coursePath } from '@/modules/academics/paths'
import { GpaValue } from '../components/GpaValue'
import { InlineInput } from '../components/InlineInput'
import { Stat } from '../components/Stat'
import { GPA_MASK, percentText } from '../display'
import { parseDecimal, parseScore } from '../score'
import { useTermGrades } from '../queries'

const features = tableFeatures({})
const column = createColumnHelper<typeof features, CourseGrade>()

/**
 * What the cells need from the page. They read it from context so the column definitions can
 * live outside the component; columns defined while rendering would make the inputs in them
 * lose what was being typed on every render.
 */
type TermCells = {
  programId: string
  termId: string
  hideGpa: boolean
  scores: Readonly<Record<string, number>>
  assume: (courseId: string, text: string) => boolean
}
const TermCellsContext = createContext<TermCells | null>(null)

function useCells(): TermCells {
  const cells = useContext(TermCellsContext)
  if (!cells) throw new Error('Term grade cells render inside TermGradesView')
  return cells
}

function CourseCell({ c }: { c: CourseGrade }) {
  const { programId, termId } = useCells()
  return (
    <HistoryLink
      href={coursePath(programId, c.course_id, 'grades', termId)}
      className="font-medium hover:underline"
    >
      {c.alias || c.code || c.title}
    </HistoryLink>
  )
}

/**
 * Whether an assumed percentage can move this term's plan: the course is unfinished, graded by
 * percentage, and carries credits in this term (a year-long course counts in one term only).
 */
function canAssume(c: CourseGrade): boolean {
  return (
    c.status === 'in_progress' &&
    c.basis === 'percentage' &&
    c.include_in_gpa &&
    (c.attributed_credits ?? 0) > 0
  )
}

function PercentageCell({ c }: { c: CourseGrade }) {
  const { scores, assume } = useCells()
  if (!canAssume(c)) {
    return <span className="block text-right tabular-nums">{percentText(c.percentage)}</span>
  }
  const assumed = scores[c.course_id]
  return (
    <div className="flex items-center justify-end gap-2">
      {c.current_percentage === null ? null : (
        <span className="text-xs text-muted-foreground tabular-nums">
          {percentText(c.current_percentage)}
        </span>
      )}
      <InlineInput
        key={`${c.course_id}-${assumed ?? ''}`}
        label={`${m.grading_assumed_score()}: ${c.title}`}
        placeholder="—"
        tone="assumed"
        value={assumed === undefined ? '' : String(Math.round(assumed * 100) / 100)}
        onCommit={(text) => assume(c.course_id, text)}
      />
    </div>
  )
}

function PointsCell({ c }: { c: CourseGrade }) {
  const { hideGpa } = useCells()
  return (
    <span className="block text-right tabular-nums">
      <GpaValue
        value={c.points}
        hidden={hideGpa}
        letter={c.letter}
        letterClassName="ml-1.5 text-xs text-muted-foreground"
      />
    </span>
  )
}

const courseColumns = column.columns([
  column.accessor((c) => c.code ?? c.title, {
    id: 'course',
    header: () => m.grading_course(),
    cell: ({ row }) => <CourseCell c={row.original} />,
  }),
  column.accessor((c) => c.credits, {
    id: 'credits',
    header: () => m.grading_credits(),
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatCredits(row.original.credits)}
        {row.original.year_long ? (
          <span className="ml-1 text-xs text-muted-foreground">
            ({formatCredits(row.original.attributed_credits ?? 0)})
          </span>
        ) : null}
      </span>
    ),
  }),
  column.accessor((c) => c.counts_in_gpa, {
    id: 'in_gpa',
    header: () => m.grading_in_gpa(),
    cell: ({ row }) => (row.original.include_in_gpa ? m.grading_yes() : m.grading_no()),
  }),
  column.accessor((c) => c.status, {
    id: 'status',
    header: () => m.grading_status(),
    cell: ({ row }) => (
      <Badge variant={row.original.status === 'failed' ? 'destructive' : 'secondary'}>
        {STATUS_LABEL[row.original.status]()}
      </Badge>
    ),
  }),
  column.accessor((c) => c.percentage ?? c.current_percentage ?? -1, {
    id: 'percentage',
    header: () => <span className="block text-right">{m.grading_percentage()}</span>,
    cell: ({ row }) => <PercentageCell c={row.original} />,
  }),
  column.accessor((c) => c.points ?? -1, {
    id: 'points',
    header: () => <span className="block text-right">{m.grading_gpa()}</span>,
    cell: ({ row }) => <PointsCell c={row.original} />,
  }),
])

/** Assumed final percentage per unfinished course, and an optional goal (M03 §5.2). */
type TermWhatIf = { scores: Record<string, number>; targetGpa: number | null }
const DEFAULT_TERM_WHAT_IF: TermWhatIf = { scores: {}, targetGpa: null }

const SIMULATE_DELAY_MS = 200

const STATUS_LABEL = {
  completed: () => m.grading_status_completed(),
  in_progress: () => m.grading_status_in_progress(),
  passed: () => m.grading_status_passed(),
  failed: () => m.grading_status_failed(),
} as const

/** A term's courses with their grades, the term GPA and a what-if for unfinished courses. */
export default function TermGradesPage({ scope }: PageProps) {
  const termId = scope.kind === 'term' ? scope.termId : ''
  const [includeInProgress, setIncludeInProgress] = useUiPref('grading.term.in_progress', false)
  return (
    <AsyncBoundary query={useTermGrades(termId, includeInProgress)}>
      {(term) => (
        <TermGradesView
          key={termId}
          term={term}
          programId={scope.programId}
          includeInProgress={includeInProgress}
          onIncludeInProgress={setIncludeInProgress}
        />
      )}
    </AsyncBoundary>
  )
}

function TermGradesView({
  term,
  programId,
  includeInProgress,
  onIncludeInProgress,
}: {
  term: TermGrades
  programId: string
  includeInProgress: boolean
  onIncludeInProgress: (value: boolean) => void
}) {
  const progressId = useId()
  const [whatIf, setWhatIf] = useUiPref<TermWhatIf>('grading.term.whatif', DEFAULT_TERM_WHAT_IF, {
    scope: term.term_id,
  })
  const open = new Set(term.courses.filter(canAssume).map((c) => c.course_id))
  const scores = Object.fromEntries(Object.entries(whatIf.scores).filter(([id]) => open.has(id)))
  const hasWhatIf = Object.keys(scores).length > 0 || whatIf.targetGpa !== null

  const simulate = useMutation({ ...gradingSimulateTermMutation(), onError: toastError })
  const run = simulate.mutate
  const fingerprint = JSON.stringify([scores, whatIf.targetGpa, includeInProgress])
  // A grade that changed under the what-if (an edit elsewhere, a sync) refreshes the plan too.
  const version = JSON.stringify(term.courses)
  useEffect(() => {
    if (!hasWhatIf) return
    const timer = setTimeout(
      () =>
        run({
          path: { term_id: term.term_id },
          body: { scores, target_gpa: whatIf.targetGpa, include_in_progress: includeInProgress },
        }),
      SIMULATE_DELAY_MS,
    )
    return () => clearTimeout(timer)
    // `fingerprint` stands for `scores`, `target_gpa` and `include_in_progress`.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [term.term_id, run, fingerprint, version, hasWhatIf])

  const assume = (courseId: string, text: string): boolean => {
    const parsed = parseScore(text)
    if (parsed.kind === 'invalid' || parsed.kind === 'points') return false
    const rest = omitKey(scores, courseId)
    setWhatIf({
      ...whatIf,
      scores: parsed.kind === 'clear' ? rest : { ...rest, [courseId]: parsed.value },
    })
    return true
  }

  const cells: TermCells = {
    programId,
    termId: term.term_id,
    hideGpa: term.hide_gpa,
    scores,
    assume,
  }

  const table = useTable({
    features,
    columns: courseColumns,
    data: term.courses,
    getRowId: (c) => c.course_id,
  })

  const planned = hasWhatIf ? simulate.data : undefined
  return (
    <TermCellsContext value={cells}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={m.grading_term_gpa()}>
            <GpaValue value={term.gpa} hidden={term.hide_gpa} />
          </Stat>
          <Stat label={m.grading_average()}>{percentText(term.average_percentage)}</Stat>
          <Stat
            label={m.grading_credits_counted()}
            hint={m.grading_credits_of({ total: formatCredits(term.credits_total) })}
          >
            {formatCredits(term.credits_counted)}
          </Stat>
          <Stat
            label={m.grading_excluded()}
            hint={
              term.in_progress_count > 0
                ? m.grading_excluded_in_progress({ count: term.in_progress_count })
                : null
            }
          >
            {term.excluded_count}
          </Stat>
        </div>

        <Field orientation="horizontal" className="w-fit">
          <Switch
            id={progressId}
            checked={includeInProgress}
            onCheckedChange={onIncludeInProgress}
          />
          <FieldLabel htmlFor={progressId} className="font-normal">
            {m.grading_include_in_progress()}
          </FieldLabel>
        </Field>

        <div className="rounded-2xl border border-border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id} className="hover:bg-transparent">
                  {group.headers.map((h) => (
                    <TableHead
                      key={h.id}
                      scope="col"
                      className="h-10 text-xs text-muted-foreground"
                    >
                      <table.FlexRender header={h} />
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {term.courses.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={courseColumns.length} className="whitespace-normal">
                    <Empty className="border-0 p-0">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <BookOpen aria-hidden />
                        </EmptyMedia>
                        <EmptyTitle>{m.grading_term_empty()}</EmptyTitle>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : null}
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id} className="py-1.5">
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {open.size > 0 ? (
          <section
            aria-label={m.grading_term_what_if()}
            className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-heading text-sm font-medium">{m.grading_term_what_if()}</h3>
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                {m.grading_term_what_if_hint()}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">{m.grading_target_gpa()}</span>
              <InlineInput
                key={`tg-${whatIf.targetGpa ?? ''}`}
                label={m.grading_target_gpa()}
                placeholder="—"
                value={whatIf.targetGpa === null ? '' : String(whatIf.targetGpa)}
                onCommit={(text) => {
                  if (text.trim() === '') {
                    setWhatIf({ ...whatIf, targetGpa: null })
                    return true
                  }
                  const value = parseDecimal(text)
                  if (value === null || value > term.max_points) return false
                  setWhatIf({ ...whatIf, targetGpa: value })
                  return true
                }}
                className="w-20 border-input"
              />
              {hasWhatIf ? (
                <Button variant="ghost" size="sm" onClick={() => setWhatIf(DEFAULT_TERM_WHAT_IF)}>
                  {m.grading_plan_clear()}
                </Button>
              ) : null}
            </div>
            {planned ? (
              <div className="grid gap-3 sm:grid-cols-3" data-testid="term-plan-result">
                <Stat label={m.grading_planned_gpa()}>
                  <GpaValue value={planned.gpa} hidden={term.hide_gpa} />
                </Stat>
                {planned.target_gpa === null ? null : (
                  <Stat
                    label={m.grading_target_check()}
                    hint={
                      planned.reachable === false
                        ? m.grading_target_out_of_reach()
                        : planned.required_percentage === null
                          ? null
                          : m.grading_term_required({
                              percentage: percentText(planned.required_percentage),
                            })
                    }
                  >
                    <span
                      className={cn(
                        'text-base',
                        planned.gap !== null && planned.gap <= 0
                          ? 'text-success'
                          : 'text-destructive',
                      )}
                    >
                      {planned.gap === null
                        ? '—'
                        : planned.gap <= 0
                          ? m.grading_target_met()
                          : m.grading_target_gap({
                              // The target is visible, so the gap would give a hidden planned GPA away.
                              gap: term.hide_gpa ? GPA_MASK : formatGpa(planned.gap),
                            })}
                    </span>
                  </Stat>
                )}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </TermCellsContext>
  )
}
