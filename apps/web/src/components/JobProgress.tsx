import type { JobOut } from '@semestra/api-client'
import { useJob } from '@/hooks/use-job'
import { useSmoothedProgress } from '@/hooks/use-smoothed-progress'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { ProgressBar, ProgressRing } from './Progress'

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
  variant?: 'bar' | 'ring' | 'inline'
  className?: string
}) {
  const { job, status, progress, stageLabel } = useJob(jobId, seed)
  const active = status === 'pending' || status === 'running'
  const displayed = Math.round(useSmoothedProgress(progress, status === 'running'))
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
          : status === 'pending'
            ? m.job_pending()
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
        <span
          className={cn(
            'truncate',
            tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {text}
        </span>
        <span className="text-muted-foreground tabular-nums">{percent}</span>
      </div>
      <ProgressBar value={value} tone={tone} label={text} />
    </div>
  )
}
