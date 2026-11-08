import type { JobOut } from '@semestra/api-client'
import { Clock3 } from 'lucide-react'
import { jobIsWaiting, jobWaitingText, jobWaitsUntil, useJob } from '@/hooks/use-job'
import { useNow } from '@/hooks/use-now'
import { useSmoothedProgress } from '@/hooks/use-smoothed-progress'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Progress } from '@/ui/progress'
import { ProgressRing } from './Progress'

/**
 * Read-only progress of a background job (file rows, the status bar, review screens). Use
 * `<AiAction>` when the user also starts or cancels the task from the same place.
 */
export function JobProgress({
  jobId,
  job: seed,
  variant = 'bar',
  className,
}: {
  jobId: string
  /** The job if already loaded, e.g. from a list. */
  job?: JobOut
  /** `compact`: a short bar and the count (or percent) on one line, under a settings row. */
  variant?: 'bar' | 'ring' | 'inline' | 'compact'
  className?: string
}) {
  const { job, status, progress, stageLabel, stageName, count } = useJob(jobId, seed)
  const active = status === 'pending' || status === 'running'
  const waiting = job ? jobIsWaiting(job) : false
  const displayed = Math.round(useSmoothedProgress(progress, status === 'running' && !waiting))
  // Ticks while a rate limit's wait counts down.
  const now = useNow(1000, (at) => job != null && (jobWaitsUntil(job) ?? 0) > at)
  if (!job) return null

  const text =
    status === 'succeeded'
      ? m.ai_action_done()
      : status === 'failed'
        ? errorMessage({
            error: { code: job.error_code ?? 'common.internal', params: job.error_params ?? {} },
          })
        : status === 'cancelled'
          ? m.job_cancelled()
          : waiting
            ? jobWaitingText(job, now)
            : stageLabel
  const value = status === 'succeeded' ? 100 : displayed
  const tone = status === 'failed' ? 'error' : status === 'succeeded' ? 'success' : 'default'
  const percent = active ? `${value}%` : ''

  if (variant === 'inline') {
    return (
      <span className={cn('text-xs text-muted-foreground tabular-nums', className)}>
        {percent ? `${text} · ${percent}` : text}
      </span>
    )
  }
  if (variant === 'compact') {
    return (
      <span className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}>
        <Progress
          value={value}
          aria-label={text}
          className="w-40 [&_[data-slot=progress-track]]:h-1"
        />
        <span className="tabular-nums">{status === 'running' && count ? count.text : percent}</span>
      </span>
    )
  }
  if (variant === 'ring') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs', className)} title={text}>
        <ProgressRing
          value={value}
          className={tone === 'error' ? 'text-destructive' : 'text-primary'}
        />
        <span className="tabular-nums">{percent}</span>
        <span className="sr-only">{text}</span>
      </span>
    )
  }
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex justify-between gap-2 text-xs">
        {/* The count sits outside the label so a narrow column cuts the words, not the count. */}
        <span
          title={text}
          className={cn(
            'flex min-w-0 gap-1',
            tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {waiting ? <Clock3 aria-hidden className="size-3.5 shrink-0 translate-y-px" /> : null}
          <span className="truncate">
            {status === 'running' && count && !waiting ? stageName : text}
          </span>
          {status === 'running' && count && !waiting ? (
            <span className="shrink-0 tabular-nums">{count.text}</span>
          ) : null}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{percent}</span>
      </div>
      <Progress
        value={value}
        aria-label={text}
        className={cn(
          '[&_[data-slot=progress-track]]:h-1',
          waiting && '[&_[data-slot=progress-indicator]]:bg-muted-foreground/40',
          tone === 'error' && '[&_[data-slot=progress-indicator]]:bg-destructive',
          tone === 'success' && '[&_[data-slot=progress-indicator]]:bg-success',
        )}
      />
    </div>
  )
}
