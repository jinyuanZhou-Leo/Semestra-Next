import { ExternalLink, Lock } from 'lucide-react'
import { m } from '@/paraglide/messages'
import { Alert, AlertDescription, AlertTitle } from '@/ui/alert'
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
