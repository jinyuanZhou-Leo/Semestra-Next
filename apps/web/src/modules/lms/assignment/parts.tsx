import type { AssignmentDetail, SubmissionDetail } from '@semestra/api-client'
import { client } from '@semestra/api-client'
import {
  ArrowUpRight,
  Download,
  ExternalLink,
  FileText,
  FileX,
  GraduationCap,
  Link2,
} from 'lucide-react'
import { CircleAlert, ListChecks, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { SafeHtml } from '@/components/SafeHtml'
import { errorCode, errorMessage } from '@/lib/errors'
import { formatBytes, formatDateTime, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Concealed } from '@/modules/grading/components/GradeValue'
import { m } from '@/paraglide/messages'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/ui/alert'
import { Button } from '@/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Skeleton } from '@/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import type { Assignment } from './queries'
import {
  type AssignmentState,
  type DueState,
  MARK_LABELS,
  type Mark,
  STATE_LABELS,
  dueHint,
  latenessLabel,
  submissionTypeLabel,
} from './status'

/**
 * The leaves of the assignment details (M09 §7.3), shared by the dialog and the phone's page:
 * where the user is, the facts, what they handed in, where it is in Semestra.
 */

type Shown = {
  assignment: Assignment
  submission: SubmissionDetail | null
  /** Where the user is with it (the server's `state`); none while the sync never read the
   * submission (M09 table 3b, row 0). */
  state: AssignmentState | null
}

/** A number of points as the platform has it: "41", "7.5". */
const points = (value: number) => String(Math.round(value * 100) / 100)

/**
 * Where the user is, in large type, and one line under it: "Not submitted · due in 4 days",
 * "Submitted · Nov 20, 18:00", "41 / 50 · Graded · 82%".
 */
export function AssignmentStatus({
  assignment: a,
  submission: s,
  state,
  marks,
  dueState,
  practice,
  now,
}: Shown & { marks: Mark[]; dueState: DueState; practice: boolean; now: number }) {
  if (state === null && !practice) return <div className="min-w-0" />
  // The marks as the server gives them (M09 3b marks); the points taken off go with late.
  const marked = marks.map((mark) =>
    mark === 'late' && s?.points_deducted
      ? m.lms_assignment_late_deducted({ points: points(s.points_deducted) })
      : MARK_LABELS[mark](),
  )
  const line = practice
    ? m.lms_assignment_practice_note()
    : state === 'graded'
      ? [
          m.lms_assignment_graded(),
          s?.score != null && a.points ? formatPercent(s.score / a.points) : null,
          s?.grade && s.grade !== String(s.score) ? s.grade : null,
          ...marked,
        ]
      : state === 'submitted'
        ? [
            s?.submitted_at
              ? m.lms_assignment_submitted_at({ time: formatDateTime(s.submitted_at) })
              : null,
            ...marked,
          ]
        : state === 'excused' || state === 'missing'
          ? marked
          : [dueHint(dueState, a.due_at, now) ?? m.lms_assignment_no_due(), ...marked]
  const text = Array.isArray(line) ? line.filter(Boolean).join(' · ') : line
  return (
    <div className="min-w-0">
      {state === 'graded' && s?.score != null ? (
        <p className="font-heading text-2xl font-semibold tabular-nums">
          <Concealed>
            {points(s.score)}
            {a.points != null ? (
              <span className="text-base font-normal text-muted-foreground">
                {' '}
                / {points(a.points)}
              </span>
            ) : null}
          </Concealed>
        </p>
      ) : (
        <p
          className={cn(
            'font-heading text-lg font-semibold',
            state === 'missing' && 'text-destructive',
          )}
        >
          {practice || state === null ? m.lms_assignment_practice() : STATE_LABELS[state]()}
        </p>
      )}
      {text ? (
        <p className="mt-0.5 text-sm text-muted-foreground">
          {state === 'graded' ? <Concealed>{text}</Concealed> : text}
        </p>
      ) : null}
    </div>
  )
}

/** The one way out: to the platform, to hand in or to look. */
export function PlatformButton({
  assignment: a,
  state,
  provider,
  practice,
}: Shown & { provider: string; practice: boolean }) {
  if (!a.web_url) return null
  const submit = !practice && !a.locked && (state === 'unsubmitted' || state === 'missing')
  return (
    <Button
      variant={submit ? 'default' : 'outline'}
      className="w-full"
      nativeButton={false}
      render={
        // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by the button's text
        <a href={a.web_url} target="_blank" rel="noopener noreferrer" />
      }
    >
      {submit ? m.lms_assignment_submit_in({ provider }) : m.lms_open_in({ provider })}
      <ExternalLink aria-hidden />
    </Button>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}

const Aside = ({ children }: { children: ReactNode }) => (
  <span className="text-muted-foreground"> · {children}</span>
)

/** The facts, one a line; those without a value are left out. */
export function AssignmentFacts({
  assignment: a,
  submission: s,
  state,
  quiz,
  className,
}: Shown & { quiz: AssignmentDetail['quiz']; className?: string }) {
  const graded = state === 'graded'
  const types = (a.submission_types ?? []).map(submissionTypeLabel)
  const extensions = (a.allowed_extensions ?? []).map((e) => `.${e}`).join(' ')
  const limited = a.allowed_attempts != null && a.allowed_attempts > 0
  const stats = a.statistics
  return (
    <dl
      className={cn('grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm', className)}
    >
      <Fact label={m.lms_assignment_due()}>
        {a.due_at ? formatDateTime(a.due_at) : m.lms_assignment_no_due()}
      </Fact>
      {!graded && a.points != null ? (
        <Fact label={m.lms_assignment_points()}>
          <span className="tabular-nums">
            {m.lms_assignment_points_value({ points: points(a.points) })}
          </span>
        </Fact>
      ) : null}
      {graded && stats?.mean != null ? (
        <Fact label={m.lms_assignment_class()}>
          <Concealed>
            <span className="tabular-nums">
              {[
                m.lms_assignment_class_mean({ value: points(stats.mean) }),
                stats.max != null ? m.lms_assignment_class_max({ value: points(stats.max) }) : null,
                stats.min != null ? m.lms_assignment_class_min({ value: points(stats.min) }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </Concealed>
        </Fact>
      ) : null}
      {a.group_name ? (
        <Fact label={m.lms_assignment_group()}>
          {a.group_name}
          {a.group_weight != null ? (
            <Aside>
              {m.lms_assignment_group_weight({ weight: formatPercent(a.group_weight / 100) })}
            </Aside>
          ) : null}
        </Fact>
      ) : null}
      {a.unlock_at ? (
        <Fact label={m.lms_assignment_opens()}>{formatDateTime(a.unlock_at)}</Fact>
      ) : null}
      {a.lock_at ? (
        <Fact label={m.lms_assignment_closes()}>{formatDateTime(a.lock_at)}</Fact>
      ) : null}
      {types.length > 0 ? (
        <Fact label={m.lms_submit_by()}>
          {types.join(m.common_list_separator())}
          {extensions ? <Aside>{extensions}</Aside> : null}
        </Fact>
      ) : null}
      {limited || s?.attempt ? (
        <Fact label={m.lms_assignment_attempts()}>
          {limited
            ? m.lms_assignment_attempts_max({ count: a.allowed_attempts ?? 0 })
            : m.lms_assignment_attempts_unlimited()}
          {s?.attempt ? (
            <Aside>{m.lms_assignment_attempts_used({ count: s.attempt })}</Aside>
          ) : null}
        </Fact>
      ) : null}
      {quiz?.question_count != null ? (
        <Fact label={m.lms_assignment_questions()}>{quiz.question_count}</Fact>
      ) : null}
      {quiz ? (
        <Fact label={m.lms_assignment_time_limit()}>
          {quiz.time_limit
            ? m.lms_assignment_minutes({ count: quiz.time_limit })
            : m.lms_assignment_no_time_limit()}
        </Fact>
      ) : null}
    </dl>
  )
}

/** Where the API streams a file the user handed in (M09 `lmsSubmittedFileContent`). */
function submittedFileUrl(
  courseId: string,
  assignmentId: string,
  fileId: string,
  download = false,
) {
  const base = client.getConfig().baseUrl ?? ''
  const path = `/courses/${encodeURIComponent(courseId)}/lms/assignments/${encodeURIComponent(assignmentId)}/submission/files/${encodeURIComponent(fileId)}/content`
  return `${base}${path}${download ? '?download=true' : ''}`
}

/**
 * What the user handed in last, in the rubric's table: the attempt and when in its head, then a
 * row per file (opened and downloaded through Semestra), the text or the address of a text or
 * website submission. From what was kept for an assessment or to-do (`held`) the files are named,
 * not opened: the course may no longer reach them.
 */
export function MySubmission({
  courseId,
  submission: s,
  marks,
  held,
  online,
}: {
  courseId: string
  submission: SubmissionDetail | null
  /** The server's marks (M09 3b marks): how late it was is shown only when marked late. */
  marks: Mark[]
  held: boolean
  /** Whether the assignment is handed in online at all. */
  online: boolean
}) {
  const files = s?.files ?? []
  const handedIn = s !== null && (s.status === 'submitted' || s.status === 'graded')
  const heading = <h3 className="text-sm font-medium">{m.lms_assignment_my_submission()}</h3>
  if (!s || !handedIn || (files.length === 0 && !s.body && !s.url && !s.submitted_at)) {
    return (
      <section className="space-y-2">
        {heading}
        <p className="text-sm text-muted-foreground">
          {online ? m.lms_assignment_not_submitted() : m.lms_assignment_nothing_online()}
        </p>
      </section>
    )
  }
  const when = [
    s.submitted_at ? formatDateTime(s.submitted_at) : null,
    marks.includes('late')
      ? s.seconds_late
        ? latenessLabel(s.seconds_late)
        : m.lms_assignment_late()
      : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <section className="space-y-2">
      {heading}
      <div className="overflow-hidden rounded-2xl border border-border bg-background">
        <Table className="table-fixed">
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className="h-auto py-2 text-muted-foreground">
                {s.attempt
                  ? m.lms_feedback_attempt({ attempt: s.attempt })
                  : m.lms_assignment_submission()}
              </TableHead>
              <TableHead scope="col" className="h-auto w-1/2 py-2 text-right text-muted-foreground">
                {when}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((f) => (
              <TableRow key={f.external_id}>
                <TableCell>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    {held ? (
                      <span className="truncate font-medium">{f.name}</span>
                    ) : (
                      <a
                        href={submittedFileUrl(courseId, s.assignment_id, f.external_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate font-medium hover:underline"
                      >
                        {f.name}
                      </a>
                    )}
                  </span>
                </TableCell>
                <TableCell className="py-1 text-right">
                  {/* The size sits next to its download button. */}
                  <span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
                    {f.size_bytes != null ? formatBytes(f.size_bytes) : null}
                    {held ? null : (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${m.lms_assignment_download()}: ${f.name}`}
                              nativeButton={false}
                              render={
                                // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by `aria-label`
                                <a
                                  href={submittedFileUrl(
                                    courseId,
                                    s.assignment_id,
                                    f.external_id,
                                    true,
                                  )}
                                />
                              }
                            />
                          }
                        >
                          <Download aria-hidden />
                        </TooltipTrigger>
                        <TooltipContent>{m.lms_assignment_download()}</TooltipContent>
                      </Tooltip>
                    )}
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {s.url ? (
              <TableRow>
                <TableCell colSpan={2}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 items-center gap-2.5 font-medium hover:underline"
                  >
                    <Link2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{s.url}</span>
                  </a>
                </TableCell>
              </TableRow>
            ) : null}
            {s.body ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={2} className="whitespace-normal">
                  <SafeHtml html={s.body} />
                </TableCell>
              </TableRow>
            ) : null}
            {files.length === 0 && !s.url && !s.body && s.submission_type ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={2} className="text-muted-foreground">
                  {submissionTypeLabel(s.submission_type)}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function Place({
  icon: Icon,
  name,
  detail,
  onOpen,
}: {
  icon: typeof GraduationCap
  name: string
  detail: string
  onOpen: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-mx-2 w-[calc(100%+1rem)] justify-start gap-2 font-normal"
      onClick={onOpen}
    >
      <Icon aria-hidden className="text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-left">{name}</span>
      <span className="shrink-0 text-muted-foreground">{detail}</span>
      <ArrowUpRight aria-hidden className="text-muted-foreground" />
    </Button>
  )
}

/**
 * Where the assignment is in Semestra: its gradebook row and its to-do, each a way there; one
 * not imported yet offers the import (through the review, as everywhere).
 */
export function InSemestra({
  detail,
  pending,
  onOpenGrades,
  onOpenTasks,
  onImport,
}: {
  detail: AssignmentDetail
  /** Its places are still being read. */
  pending: boolean
  onOpenGrades: (assessmentId: string) => void
  onOpenTasks: () => void
  /** Leaves out the import (a course no longer linked has nothing to import from). */
  onImport?: () => void
}) {
  const { assessment, task } = detail
  if (!pending && !assessment && !task && !onImport) return null
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{m.lms_assignment_in_semestra()}</p>
      {pending ? (
        <Skeleton className="h-8" />
      ) : assessment || task ? (
        <div>
          {assessment ? (
            <Place
              icon={GraduationCap}
              name={m.lms_assignment_gradebook()}
              detail={m.lms_assignment_weight({ weight: formatPercent(assessment.weight / 100) })}
              onOpen={() => onOpenGrades(assessment.id)}
            />
          ) : null}
          {task ? (
            <Place
              icon={ListChecks}
              name={m.lms_assignment_todo()}
              detail={task.completed ? m.lms_assignment_todo_done() : m.lms_assignment_todo_open()}
              onOpen={onOpenTasks}
            />
          ) : null}
        </div>
      ) : (
        <Button variant="outline" size="sm" className="w-full" onClick={onImport}>
          <Plus aria-hidden />
          {m.lms_assignment_add()}
        </Button>
      )}
    </div>
  )
}

/**
 * Why what is shown may not be the platform as it is now, and from when (M09 §7.3): what was
 * kept for an assessment or to-do, or the mirror while the sync can't bring it up to date. What
 * was read now, or a mirror that is in step, needs no word.
 */
export function SourceNote({ detail, provider }: { detail: AssignmentDetail; provider: string }) {
  if (detail.source !== 'mirror') return null
  const why = detail.held
    ? m.lms_assignment_source_held({ provider })
    : detail.area_hidden
      ? m.lms_assignment_source_area_hidden({ provider })
      : detail.sync_failed
        ? m.lms_assignment_source_sync_failed({ provider })
        : null
  if (!why) return null
  return (
    <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
      {why}{' '}
      {detail.as_of
        ? m.lms_assignment_source_at({ time: formatDateTime(detail.as_of) })
        : m.lms_assignment_source_earlier()}
    </p>
  )
}

/**
 * The read failed: the assignment is no longer on the platform (nothing to ask again), or what
 * went wrong with a way to ask again.
 */
export function AssignmentError({
  error,
  provider,
  onRetry,
}: {
  error: unknown
  provider: string
  onRetry: () => void
}) {
  if (errorCode(error) === 'lms.not_found')
    return (
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileX />
          </EmptyMedia>
          <EmptyTitle>{m.lms_assignment_gone({ provider })}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertTitle>{m.common_load_failed()}</AlertTitle>
      <AlertDescription>{errorMessage(error)}</AlertDescription>
      <AlertAction>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {m.common_retry()}
        </Button>
      </AlertAction>
    </Alert>
  )
}
