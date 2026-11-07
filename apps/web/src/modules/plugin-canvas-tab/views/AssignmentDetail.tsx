import type {
  AssignmentOut,
  Quiz,
  RubricCriterion,
  RubricScore,
  SubmissionDetail,
} from '@semestra/api-client'
import { lmsSubmissionGetOptions } from '@semestra/api-client/react-query'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  type CellContext,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/ui/item'
import { cn } from '@/lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { CanvasBoundary, ListSkeleton } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { CanvasHtml, DisplayMenu, LockNote, OpenInCanvasIcon, attemptsLabel } from './common'

/** Canvas `submission_types`, as a student reads them. */
const SUBMISSION_TYPES: Record<string, () => string> = {
  online_upload: m.canvas_tab_submit_upload,
  online_text_entry: m.canvas_tab_submit_text,
  online_url: m.canvas_tab_submit_url,
  online_quiz: m.canvas_tab_submit_quiz,
  media_recording: m.canvas_tab_submit_media,
  student_annotation: m.canvas_tab_submit_annotation,
  discussion_topic: m.canvas_tab_submit_discussion,
  external_tool: m.canvas_tab_submit_external,
  on_paper: m.canvas_tab_submit_paper,
  none: m.canvas_tab_submit_none,
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

/**
 * An assignment opened in the list: when it can be submitted and how, why it is locked, its
 * description, then the user's grade with the teacher's comments and rubric (M16 §4). A quiz adds
 * its questions and time limit; a practice quiz (no assignment, no grade) has no feedback.
 */
export function AssignmentDetail({
  assignment: a,
  quiz,
  practice = false,
}: {
  assignment: AssignmentOut
  quiz?: Quiz | null
  practice?: boolean
}) {
  const types = (a.submission_types ?? []).map((t) => SUBMISSION_TYPES[t]?.() ?? t)
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {a.unlock_at ? (
            <Fact label={m.canvas_tab_available_from()} value={formatDateTime(a.unlock_at)} />
          ) : null}
          {a.lock_at ? (
            <Fact label={m.canvas_tab_available_until()} value={formatDateTime(a.lock_at)} />
          ) : null}
          {types.length > 0 ? (
            <Fact label={m.canvas_tab_submit_by()} value={types.join(', ')} />
          ) : null}
          <Fact
            label={m.canvas_tab_column_attempts()}
            value={attemptsLabel(quiz ? quiz.allowed_attempts : a.allowed_attempts)}
          />
          {quiz?.question_count != null ? (
            <Fact label={m.canvas_tab_column_questions()} value={String(quiz.question_count)} />
          ) : null}
          {quiz ? (
            <Fact
              label={m.canvas_tab_column_time_limit()}
              value={
                quiz.time_limit
                  ? m.canvas_tab_minutes({ count: quiz.time_limit })
                  : m.canvas_tab_no_time_limit()
              }
            />
          ) : null}
        </dl>
        <div className="flex shrink-0 items-center gap-1">
          {a.html ? <DisplayMenu /> : null}
          {a.web_url ? <OpenInCanvasIcon href={a.web_url} /> : null}
        </div>
      </div>
      {a.locked ? (
        <LockNote title={m.canvas_tab_assignment_locked()} explanation={a.lock_explanation} />
      ) : null}
      {a.html ? (
        <CanvasHtml html={a.html} />
      ) : (
        <p className="text-sm text-muted-foreground">{m.canvas_tab_no_description()}</p>
      )}
      {practice ? null : <Feedback assignment={a} />}
    </div>
  )
}

function Feedback({ assignment: a }: { assignment: AssignmentOut }) {
  const { courseId } = useCanvasPage()
  const submission = useQuery({
    ...lmsSubmissionGetOptions({ path: { course_id: courseId, assignment_id: a.external_id } }),
    placeholderData: keepPreviousData,
  })
  return (
    <section className="space-y-3" aria-label={m.canvas_tab_feedback()}>
      <h3 className="text-sm font-medium">{m.canvas_tab_feedback()}</h3>
      <CanvasBoundary query={submission} skeleton={<ListSkeleton rows={2} />}>
        {(s) => <FeedbackBody submission={s} assignment={a} />}
      </CanvasBoundary>
    </section>
  )
}

function FeedbackBody({
  submission: s,
  assignment: a,
}: {
  submission: SubmissionDetail
  assignment: AssignmentOut
}) {
  const score =
    s.score == null ? null : a.points == null ? String(s.score) : `${s.score} / ${a.points}`
  const facts = [
    score ? m.canvas_tab_feedback_score({ score }) : m.canvas_tab_feedback_not_graded(),
    s.grade && s.grade !== String(s.score) ? s.grade : null,
    s.attempt ? m.canvas_tab_feedback_attempt({ attempt: s.attempt }) : null,
    s.graded_at ? m.canvas_tab_feedback_graded_at({ time: formatDateTime(s.graded_at) }) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const comments = s.comments ?? []
  return (
    <div className="space-y-3">
      <p className="text-sm">{facts}</p>
      {(a.rubric ?? []).length > 0 ? <Rubric criteria={a.rubric ?? []} submission={s} /> : null}
      {comments.length > 0 ? (
        <ItemGroup className="gap-2">
          {comments.map((c, i) => (
            <Item key={`${c.created_at ?? ''}-${i}`} variant="muted" size="sm">
              <ItemContent>
                <ItemDescription>
                  {[c.author, c.created_at ? formatDateTime(c.created_at) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </ItemDescription>
                <ItemTitle className="font-normal break-words whitespace-pre-wrap">
                  {c.comment}
                </ItemTitle>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      ) : (
        <p className="text-sm text-muted-foreground">{m.canvas_tab_feedback_no_comments()}</p>
      )}
    </div>
  )
}

/** One rubric criterion with what the teacher gave for it, if it was assessed. */
type RubricRow = { criterion: RubricCriterion; score?: RubricScore }

const rubricFeatures = tableFeatures({})
const rubricColumn = createColumnHelper<typeof rubricFeatures, RubricRow>()
type RubricCell = CellContext<typeof rubricFeatures, RubricRow>

function CriterionCell({ row }: RubricCell) {
  const c = row.original.criterion
  return (
    <>
      <p className="font-medium">{c.description}</p>
      {c.long_description ? (
        <p className="text-xs text-muted-foreground">{c.long_description}</p>
      ) : null}
    </>
  )
}

function RatingCell({ row }: RubricCell) {
  const { criterion: c, score } = row.original
  const rating = c.ratings?.find((r) => r.id != null && r.id === score?.rating_id)
  return (
    <>
      {rating?.description ?? '—'}
      {score?.comments ? <p className="text-xs text-muted-foreground">{score.comments}</p> : null}
    </>
  )
}

function RubricPointsCell({ row }: RubricCell) {
  const { criterion: c, score } = row.original
  const earned = score?.points == null ? null : String(score.points)
  const text = c.points == null ? (earned ?? '—') : `${earned ?? '–'} / ${c.points}`
  return <span className="tabular-nums">{text}</span>
}

const rubricColumns = rubricColumn.columns([
  rubricColumn.display({
    id: 'criterion',
    header: () => m.canvas_tab_rubric_criterion(),
    cell: CriterionCell,
  }),
  rubricColumn.display({
    id: 'rating',
    header: () => m.canvas_tab_rubric_rating(),
    cell: RatingCell,
  }),
  rubricColumn.display({
    id: 'points',
    header: () => m.canvas_tab_column_points(),
    cell: RubricPointsCell,
  }),
])

/** The rubric with the rating the teacher picked per criterion, when it was assessed. */
function Rubric({
  criteria,
  submission,
}: {
  criteria: RubricCriterion[]
  submission: SubmissionDetail
}) {
  const scores = new Map((submission.rubric_scores ?? []).map((r) => [r.criterion_id, r]))
  const data = criteria.map((criterion) => ({ criterion, score: scores.get(criterion.id) }))
  const table = useTable({
    features: rubricFeatures,
    columns: rubricColumns,
    data,
    getRowId: (r) => r.criterion.id,
  })
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background">
      <Table>
        <TableHeader className="bg-muted/50">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((h) => (
                <TableHead
                  key={h.id}
                  scope="col"
                  className={cn(
                    'h-auto py-2 text-muted-foreground',
                    h.column.id === 'points' && 'text-right',
                  )}
                >
                  <table.FlexRender header={h} />
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} className="align-top">
              {row.getAllCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={cell.column.id === 'points' ? 'text-right' : 'whitespace-normal'}
                >
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
