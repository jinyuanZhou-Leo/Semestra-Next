import { ExternalLink, Lock } from 'lucide-react'
import {
  type AssignmentState,
  type DueState,
  MARK_LABELS,
  type Mark,
  STATE_LABELS,
  dueHint,
} from '@/modules/lms/assignment/status'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'

export function OpenInCanvas({ href, label }: { href: string; label?: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="shrink-0"
      // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
      render={<a href={href} target="_blank" rel="noopener noreferrer" />}
      nativeButton={false}
    >
      <ExternalLink aria-hidden />
      {label ?? m.canvas_tab_open_in_canvas()}
    </Button>
  )
}

/** "Unlimited" for Canvas's -1 (or no value), else the number of attempts allowed. */
export function attemptsLabel(allowed: number | null | undefined): string {
  return allowed == null || allowed < 0
    ? m.canvas_tab_attempts_unlimited()
    : m.canvas_tab_attempts_allowed({ count: allowed })
}

/** Why Canvas keeps something locked, in its own words (`lock_explanation`). */
export function LockNote({ title, explanation }: { title: string; explanation?: string | null }) {
  return (
    <Alert>
      <Lock aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      {explanation ? <AlertDescription>{explanation}</AlertDescription> : null}
    </Alert>
  )
}

/** "8.5 / 10", "– / 10" before a score, or just the score when there are no points. */
export function ScoreText({
  score,
  points,
}: {
  score: number | null | undefined
  points: number | null | undefined
}) {
  if (score == null && points == null) return <span className="text-muted-foreground">—</span>
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className={score == null ? 'text-muted-foreground' : 'font-medium'}>
        {score ?? '–'}
      </span>
      {points == null ? null : <span className="text-muted-foreground"> / {points}</span>}
    </span>
  )
}

/**
 * Where the user is with an assignment, as M09 tables 3b and 3d give it: the state's badge, the
 * server's marks beside it (missing, late), and the due hint; the same in the assignments, quizzes
 * and grades (M16). A missing assignment's badge already says so, so it has no due hint.
 */
export function SubmissionStatus({
  state,
  marks,
  dueState,
  dueAt,
  now,
}: {
  state: AssignmentState | null
  marks: Mark[]
  dueState: DueState
  dueAt: string | null | undefined
  now: number
}) {
  const hint = state === 'missing' ? null : dueHint(dueState, dueAt, now)
  const markers = marks.map((mark) =>
    mark === 'missing' ? (
      <Badge key="missing" variant="outline" className="border-destructive/40 text-destructive">
        {MARK_LABELS.missing()}
      </Badge>
    ) : (
      <Badge key="late" variant="outline">
        {MARK_LABELS.late()}
      </Badge>
    ),
  )
  const badge =
    state === null ? null : state === 'missing' ? (
      <Badge variant="destructive">{STATE_LABELS.missing()}</Badge>
    ) : state === 'unsubmitted' || state === 'offline' ? (
      hint === null || state === 'offline' ? (
        <span className="whitespace-nowrap text-muted-foreground">{STATE_LABELS[state]()}</span>
      ) : null
    ) : (
      <Badge variant="secondary">{STATE_LABELS[state]()}</Badge>
    )
  return (
    <span className="flex items-center gap-1">
      {badge}
      {markers}
      {hint ? <DueHint dueState={dueState}>{hint}</DueHint> : null}
    </span>
  )
}

/** Table 3d's look: upcoming in the accent, overdue in red, past (can't tell if done) muted. */
function DueHint({ dueState, children }: { dueState: DueState; children: string }) {
  if (dueState === 'past') {
    return <span className="whitespace-nowrap text-muted-foreground">{children}</span>
  }
  return (
    <Badge
      variant="outline"
      className={
        dueState === 'overdue'
          ? 'border-destructive/40 text-destructive'
          : 'border-primary/40 text-primary'
      }
    >
      {children}
    </Badge>
  )
}
