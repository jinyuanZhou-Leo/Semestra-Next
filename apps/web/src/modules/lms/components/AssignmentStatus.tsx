import { FileText, ListChecks, Lock, MessagesSquare } from 'lucide-react'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import {
  type AssignmentState,
  type DueState,
  MARK_LABELS,
  type Mark,
  STATE_LABELS,
  dueHint,
} from '../assignment/status'

/**
 * What kind of work an assignment is, by how it is handed in: a quiz, a discussion or an
 * assignment. Its icon and name, the same in the Canvas tab and the gradebook.
 */
export function assignmentKind(submissionTypes: readonly string[], quiz: boolean) {
  if (quiz || submissionTypes.includes('online_quiz')) {
    return { Icon: ListChecks, label: m.lms_kind_quiz() }
  }
  if (submissionTypes.includes('discussion_topic')) {
    return { Icon: MessagesSquare, label: m.lms_kind_discussion() }
  }
  return { Icon: FileText, label: m.lms_kind_assignment() }
}

/**
 * Where the user is with an assignment, as M09 tables 3b and 3d give it: the state's badge, the
 * server's marks beside it (missing, late), and the due hint; the same in the Canvas tab (M16)
 * and the gradebook (M03). A missing assignment's badge already says so, so it has no due hint.
 */
export function SubmissionStatus({
  state,
  marks,
  dueState,
  dueAt,
  now,
}: {
  state: AssignmentState | null
  marks: readonly Mark[]
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

/** A locked assignment's lock, with why the platform keeps it locked on hover. */
export function LockMark({ explanation }: { explanation: string | null | undefined }) {
  const why = explanation || m.lms_locked()
  return (
    <Tooltip>
      <TooltipTrigger
        className="inline-flex shrink-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label={why}
        onClick={(event) => event.stopPropagation()}
      >
        <Lock aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{why}</TooltipContent>
    </Tooltip>
  )
}
