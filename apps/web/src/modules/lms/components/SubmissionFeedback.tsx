import type {
  AssignmentOut,
  RubricCriterion,
  RubricScore,
  SubmissionDetail,
} from '@semestra/api-client'
import {
  type CellContext,
  createColumnHelper,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/ui/item'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'

/** What the feedback shows of a submission: as read from the platform, or as the sync kept it. */
type Feedback = Pick<
  SubmissionDetail,
  'score' | 'grade' | 'attempt' | 'graded_at' | 'comments' | 'rubric_scores'
>

/**
 * The teacher's feedback on the user's submission of an assignment (M09 §6): the score, the
 * rubric with the rating picked per criterion, and the comments. Shown in the Canvas tab's
 * assignment detail (M16, read from the platform) and the gradebook's feedback dialog (M03, as
 * the sync kept it).
 */
export function SubmissionFeedback({
  submission: s,
  assignment: a,
}: {
  submission: Feedback
  assignment: Pick<AssignmentOut, 'points' | 'rubric'>
}) {
  const score =
    s.score == null ? null : a.points == null ? String(s.score) : `${s.score} / ${a.points}`
  const facts = [
    score ? m.lms_feedback_score({ score }) : m.lms_feedback_not_graded(),
    s.grade && s.grade !== String(s.score) ? s.grade : null,
    s.attempt ? m.lms_feedback_attempt({ attempt: s.attempt }) : null,
    s.graded_at ? m.lms_feedback_graded_at({ time: formatDateTime(s.graded_at) }) : null,
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
        <p className="text-sm text-muted-foreground">{m.lms_feedback_no_comments()}</p>
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
    header: () => m.lms_rubric_criterion(),
    cell: CriterionCell,
  }),
  rubricColumn.display({
    id: 'rating',
    header: () => m.lms_rubric_rating(),
    cell: RatingCell,
  }),
  rubricColumn.display({
    id: 'points',
    header: () => m.lms_rubric_points(),
    cell: RubricPointsCell,
  }),
])

/** The rubric with the rating the teacher picked per criterion, when it was assessed. */
function Rubric({ criteria, submission }: { criteria: RubricCriterion[]; submission: Feedback }) {
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
