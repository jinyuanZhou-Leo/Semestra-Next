import type { Submission } from '@semestra/api-client'
import { ArrowLeft, ExternalLink, Lock } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import type { InternalLink } from '@/components/SafeHtml'
import { formatDaysUntil } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { useCanvasPage } from '../context'
import { fileContentUrl } from '../open-in-canvas'
import { refLocation } from '../navigation'

/** The title row of an item opened inside a view: back to the list, the item, Canvas. */
export function DetailHeader({
  title,
  meta,
  webUrl,
  onBack,
}: {
  title: string
  meta?: ReactNode
  webUrl?: string | null
  onBack: () => void
}) {
  return (
    <div className="space-y-2">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft aria-hidden />
        {m.canvas_tab_back()}
      </Button>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-semibold">{title}</h2>
          {meta ? <p className="text-sm text-muted-foreground">{meta}</p> : null}
        </div>
        {webUrl ? <OpenInCanvasIcon href={webUrl} /> : null}
      </div>
    </div>
  )
}

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

/** An icon button with its name in a tooltip; `tooltip` is shorter text when the name is long. */
export function IconAction({
  label,
  tooltip,
  children,
  ...props
}: { label: string; tooltip?: string; children: ReactNode } & ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={label} {...props} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  )
}

export function OpenInCanvasIcon({ href }: { href: string }) {
  return (
    <IconAction
      label={m.canvas_tab_open_in_canvas()}
      className="shrink-0"
      nativeButton={false}
      // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- labelled by `label`
      render={<a href={href} target="_blank" rel="noopener noreferrer" />}
    >
      <ExternalLink aria-hidden />
    </IconAction>
  )
}

/**
 * Opens a Canvas link from inside HTML in the plugin: pages, assignments, quizzes, modules and
 * announcements switch the view, files open the preview; anything else stays a normal link.
 */
export function useInternalLinks() {
  const { go, openFile } = useCanvasPage()
  return (link: InternalLink) => {
    if (link.kind === 'file') {
      openFile(link.ref)
      return true
    }
    const target = refLocation(link)
    if (!target) return false
    go(target)
    return true
  }
}

/** Images of course files in Canvas HTML load through the file proxy (M09 §2.1); when that fails
 * (another course's file, one the token can't read) `SafeHtml` goes back to Canvas's address. */
export function useFileImages() {
  const { courseId } = useCanvasPage()
  return (link: InternalLink) => (link.kind === 'file' ? fileContentUrl(courseId, link.ref) : null)
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
 * Where the user's submission stands, as badges: missing, graded, submitted (late), or due soon;
 * the same in the assignments, quizzes and grades (M16 §4). `now` is read once by the caller.
 */
export function SubmissionStatus({
  submission: s,
  dueAt,
  now,
}: {
  submission: Submission | null | undefined
  dueAt: string | null | undefined
  now: number
}) {
  if (!s) return null
  const late = s.late ? (
    <Badge variant="outline">{m.canvas_tab_submission_late_short()}</Badge>
  ) : null
  if (s.missing) {
    return <Badge variant="destructive">{m.canvas_tab_submission_missing()}</Badge>
  }
  if (s.state === 'graded') {
    return (
      <span className="flex items-center gap-1">
        <Badge variant="secondary">{m.canvas_tab_submission_graded()}</Badge>
        {late}
      </span>
    )
  }
  if (s.submitted_at || s.state === 'submitted' || s.state === 'pending_review') {
    return (
      <span className="flex items-center gap-1">
        <Badge variant="secondary">{m.canvas_tab_submission_submitted()}</Badge>
        {late}
      </span>
    )
  }
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
      {m.canvas_tab_submission_unsubmitted()}
    </span>
  )
}
