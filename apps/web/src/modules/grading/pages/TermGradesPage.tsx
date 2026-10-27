import type { CourseGrade, TermGrades } from '@semestra/api-client'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { BookOpen, Calculator } from 'lucide-react'
import { createContext, useContext, useId } from 'react'
import { toast } from 'sonner'
import type { PageProps } from '@/app/extensions'
import { updateUiPref, useUiPref } from '@/app/ui-pref'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { HistoryLink } from '@/components/HistoryLink'
import { formatCredits } from '@/lib/format'
import { omitKey } from '@/lib/omit'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Label } from '@/ui/label'
import { Switch } from '@/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { coursePath } from '@/modules/academics/paths'
import { useCourses } from '@/modules/academics/queries'
import { GpaValue } from '../components/GpaValue'
import { GradeTableCard, PlanBar } from '../components/GradeTableCard'
import { InlineInput } from '../components/InlineInput'
import { TermPlanTarget } from '../components/TargetCard'
import { TermComposition, courseStatusLabel } from '../components/TermComposition'
import { percentText } from '../display'
import { parseScore } from '../score'
import { IN_PROGRESS_PREF, useTermGrades } from '../queries'
import { useTermPlanSimulation } from '../use-plan'

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
  planning: boolean
  colors: ReadonlyMap<string, string>
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
  const { programId, termId, colors } = useCells()
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: colors.get(c.course_id) ?? 'var(--muted-foreground)' }}
      />
      <HistoryLink
        href={coursePath(programId, c.course_id, 'grades', termId)}
        className="truncate font-medium hover:underline"
      >
        {courseLabel(c)}
      </HistoryLink>
    </span>
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

/**
 * The final percentage, or in plan mode the assumed one of an unfinished course. Like a course's
 * score column, every row keeps a slot after it, here for an unfinished course's current average.
 */
function PercentageCell({ c }: { c: CourseGrade }) {
  const { planning, scores, assume } = useCells()
  const assumed = scores[c.course_id]
  return (
    <div className="flex items-center justify-end gap-1">
      {planning && canAssume(c) ? (
        <InlineInput
          key={`${c.course_id}-${assumed ?? ''}`}
          label={`${m.grading_assumed_score()}: ${c.title}`}
          placeholder="—"
          tone="assumed"
          value={assumed === undefined ? '' : String(Math.round(assumed * 100) / 100)}
          onCommit={(text) => assume(c.course_id, text)}
        />
      ) : (
        <span className="w-24 px-3 text-right tabular-nums">{percentText(c.percentage)}</span>
      )}
      <span className="w-12 text-left text-xs text-muted-foreground tabular-nums">
        {c.status === 'in_progress' && c.current_percentage !== null ? (
          <>
            <span className="sr-only">{m.grading_current()}: </span>
            {percentText(c.current_percentage)}
          </>
        ) : null}
      </span>
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
    header: () => <span className="block text-right">{m.grading_credits()}</span>,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">
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
        {courseStatusLabel(row.original.status)}
      </Badge>
    ),
  }),
  column.accessor((c) => c.percentage ?? c.current_percentage ?? -1, {
    id: 'percentage',
    header: () => <span className="block pr-16 text-right">{m.grading_percentage()}</span>,
    cell: ({ row }) => <PercentageCell c={row.original} />,
  }),
  column.accessor((c) => c.points ?? -1, {
    id: 'points',
    header: () => <span className="block text-right">{m.grading_gpa()}</span>,
    cell: ({ row }) => <PointsCell c={row.original} />,
  }),
])

/** Plan mode of a term (M03 §5.2): assumed final percentage per unfinished course and a goal. */
type TermWhatIf = { plan: boolean; scores: Record<string, number>; targetGpa: number | null }
const DEFAULT_TERM_WHAT_IF: TermWhatIf = { plan: false, scores: {}, targetGpa: null }

/** A term's courses with their grades, the term GPA and plan mode for unfinished courses. */
export default function TermGradesPage({ scope }: PageProps) {
  const termId = scope.kind === 'term' ? scope.termId : ''
  const [includeInProgress, setIncludeInProgress] = useUiPref(IN_PROGRESS_PREF, false)
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
  const termId = term.term_id
  const queryClient = useQueryClient()
  const [stored, setWhatIf] = useUiPref<TermWhatIf>('grading.term.whatif', DEFAULT_TERM_WHAT_IF, {
    scope: termId,
  })
  // Saved before plan mode existed, a what-if has no `plan` yet.
  const whatIf = { ...DEFAULT_TERM_WHAT_IF, ...stored }
  const courses = useCourses(programId, termId).data?.items ?? []
  const colors = new Map(courses.map((c) => [c.id, courseColor(c)]))

  const open = new Set(term.courses.filter(canAssume).map((c) => c.course_id))
  const scores = Object.fromEntries(Object.entries(whatIf.scores).filter(([id]) => open.has(id)))
  const canPlan = open.size > 0
  const planning = whatIf.plan && canPlan
  const planned = useTermPlanSimulation(term, scores, whatIf.targetGpa, includeInProgress, planning)

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
  const clearAssumptions = () => {
    const before = whatIf.scores
    setWhatIf({ ...whatIf, scores: {} })
    // Undo brings back only the scores, on top of whatever changed since.
    const undo = () =>
      void updateUiPref<TermWhatIf>(queryClient, `grading.term.whatif.${termId}`, (current) => ({
        ...DEFAULT_TERM_WHAT_IF,
        ...current,
        scores: { ...before, ...current?.scores },
      }))
    toast(m.grading_plan_cleared(), { action: { label: m.common_undo(), onClick: undo } })
  }

  const cells: TermCells = {
    programId,
    termId,
    hideGpa: term.hide_gpa,
    planning,
    colors,
    scores,
    assume,
  }

  const table = useTable({
    features,
    columns: courseColumns,
    data: term.courses,
    getRowId: (c) => c.course_id,
  })

  return (
    <TermCellsContext value={cells}>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <GradeTableCard
          planning={planning}
          toolbar={
            planning ? (
              <PlanBar
                hint={m.grading_term_plan_hint()}
                hasAssumptions={Object.keys(scores).length > 0}
                onClearAssumptions={clearAssumptions}
                onExit={() => setWhatIf({ ...whatIf, plan: false })}
              />
            ) : (
              <TermToolbar
                count={term.courses.length}
                canPlan={canPlan}
                onPlan={() => setWhatIf({ ...whatIf, plan: true })}
                includeInProgress={includeInProgress}
                onIncludeInProgress={onIncludeInProgress}
              />
            )
          }
        >
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
                    <TableCell key={cell.id} className="h-12 py-1.5">
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </GradeTableCard>
        {/* On narrow screens the summary comes first. */}
        <aside className="-order-1 grid gap-4 sm:grid-cols-2 lg:sticky lg:top-4 lg:order-none lg:grid-cols-1">
          <TermComposition
            term={term}
            planned={planned}
            planning={planning}
            scores={scores}
            colors={colors}
            label={courseLabel}
          />
          {planning ? (
            <TermPlanTarget
              targetGpa={whatIf.targetGpa}
              maxPoints={term.max_points}
              hideGpa={term.hide_gpa}
              planned={planned}
              onChange={(targetGpa) => setWhatIf({ ...whatIf, targetGpa })}
            />
          ) : null}
        </aside>
      </div>
    </TermCellsContext>
  )
}

/** The header bar of the term's course table. */
function TermToolbar({
  count,
  canPlan,
  onPlan,
  includeInProgress,
  onIncludeInProgress,
}: {
  count: number
  /** Plan mode needs an unfinished course to assume a grade for. */
  canPlan: boolean
  onPlan: () => void
  includeInProgress: boolean
  onIncludeInProgress: (value: boolean) => void
}) {
  const includeId = useId()
  const plan = (
    <Button variant="outline" size="sm" disabled={!canPlan} onClick={onPlan}>
      <Calculator aria-hidden />
      {m.grading_plan()}
    </Button>
  )
  return (
    <div className="flex h-8 items-center gap-2">
      <h2 className="flex-1 truncate text-sm font-medium">
        {m.grading_term_courses_heading()}{' '}
        <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
      </h2>
      {canPlan ? (
        plan
      ) : (
        <Tooltip>
          {/* A disabled button gets no pointer events; the wrapper shows why it is off. */}
          <TooltipTrigger render={<span className="inline-flex" />}>{plan}</TooltipTrigger>
          <TooltipContent>{m.grading_term_plan_unavailable()}</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        {/* The whole switch and its label explain what "unfinished" counts. */}
        <TooltipTrigger render={<div className="flex items-center gap-2 px-1" />}>
          <Switch
            id={includeId}
            size="sm"
            checked={includeInProgress}
            onCheckedChange={onIncludeInProgress}
          />
          <Label htmlFor={includeId} className="font-normal">
            {m.grading_count_in_progress()}
          </Label>
        </TooltipTrigger>
        <TooltipContent>{m.grading_include_in_progress()}</TooltipContent>
      </Tooltip>
    </div>
  )
}
