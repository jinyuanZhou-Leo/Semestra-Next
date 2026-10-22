import type {
  AssignmentOut,
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
import { SafeHtml } from '@/components/SafeHtml'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { CanvasBoundary, ListSkeleton } from '../CanvasBoundary'
import { useCanvasPage } from '../context'
import { LockNote, OpenInCanvas, attemptsLabel, useInternalLinks } from './common'

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
 * description, then the user's grade with the teacher's comments and rubric (M16 §4).
 */
export function AssignmentDetail({ assignment: a }: { assignment: AssignmentOut }) {
  const onLink = useInternalLinks()
  const types = (a.submission_types ?? []).map((t) => SUBMISSION_TYPES[t]?.() ?? t)
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <Fact
          label={m.canvas_tab_available_from()}
          value={a.unlock_at ? formatDateTime(a.unlock_at) : '—'}
        />
        <Fact
          label={m.canvas_tab_available_until()}
          value={a.lock_at ? formatDateTime(a.lock_at) : '—'}
        />
        <Fact label={m.canvas_tab_submit_by()} value={types.join(', ') || '—'} />
        <Fact label={m.canvas_tab_column_attempts()} value={attemptsLabel(a.allowed_attempts)} />
      </dl>
      {a.locked ? (
        <LockNote title={m.canvas_tab_assignment_locked()} explanation={a.lock_explanation} />
      ) : null}
      {a.html ? (
        <SafeHtml html={a.html} onInternalLink={onLink} />
      ) : (
        <p className="text-sm text-muted-foreground">{m.canvas_tab_no_description()}</p>
      )}
      <Feedback assignment={a} />
      {a.web_url ? <OpenInCanvas href={a.web_url} /> : null}
    </div>
  )
}

function Feedback({ assignment: a }: { assignment: AssignmentOut }) {
  const { courseId, query } = useCanvasPage()
  const submission = useQuery({
    ...lmsSubmissionGetOptions({
      path: { course_id: courseId, assignment_id: a.external_id },
      query,
    }),
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
        <ul className="space-y-2">
          {comments.map((c, i) => (
            <li key={`${c.created_at ?? ''}-${i}`} className="rounded-lg bg-muted/50 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                {[c.author, c.created_at ? formatDateTime(c.created_at) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="text-sm break-words whitespace-pre-wrap">{c.comment}</p>
            </li>
          ))}
        </ul>
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
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((h) => (
              <TableHead key={h.id} className={h.column.id === 'points' ? 'text-right' : undefined}>
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
  )
}
