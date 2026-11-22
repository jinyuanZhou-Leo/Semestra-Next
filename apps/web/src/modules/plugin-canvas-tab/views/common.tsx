import { ExternalLink, Lock } from 'lucide-react'
import { formatDaysUntil } from '@/lib/format'
import { type AssignmentState, STATE_LABELS } from '@/modules/lms/assignment/status'
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

/** Unsubmitted work due within this many days says so. */
const DUE_SOON_DAYS = 7
const DAY_MS = 86_400_000

/**
 * Where the user is with an assignment (the server's `state`), as badges: graded or submitted
 * (late), excused, missing, due soon, not submitted, or no online submission (never "due"); the
 * same in the assignments, quizzes and grades (M16 §4). `now` is read once by the caller.
 */
export function SubmissionStatus({
  state,
  late: isLate,
  dueAt,
  now,
}: {
  state: AssignmentState
  late: boolean
  dueAt: string | null | undefined
  now: number
}) {
  const late = isLate ? (
    <Badge variant="outline">{m.lms_assignment_late()}</Badge>
  ) : null
  switch (state) {
    case 'missing':
      return <Badge variant="destructive">{STATE_LABELS.missing()}</Badge>
    case 'graded':
    case 'submitted':
      return (
        <span className="flex items-center gap-1">
          <Badge variant="secondary">{STATE_LABELS[state]()}</Badge>
          {late}
        </span>
      )
    case 'excused':
      return <Badge variant="secondary">{STATE_LABELS.excused()}</Badge>
    case 'offline':
      return (
        <span className="whitespace-nowrap text-muted-foreground">{STATE_LABELS.offline()}</span>
      )
    case 'unsubmitted': {
      const due = dueAt ? new Date(dueAt).getTime() : null
      if (due != null && due > now && due - now <= DUE_SOON_DAYS * DAY_MS) {
        return (
          <Badge variant="outline" className="border-primary/40 text-primary">
            {m.canvas_tab_due_relative({ time: formatDaysUntil(new Date(due), now) })}
          </Badge>
        )
      }
      return (
        <span className="whitespace-nowrap text-muted-foreground">
          {STATE_LABELS.unsubmitted()}
        </span>
      )
    }
  }
}
