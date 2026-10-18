import { coreJobListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { LoaderCircle } from 'lucide-react'
import { jobStageLabel } from '@/hooks/use-job'
import { useSmoothedProgress } from '@/hooks/use-smoothed-progress'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Progress } from '@/ui/progress'
import type { StatusItem, StatusItemContribution } from '../extensions'
import { useStatusItems } from '../registry'

/** The host's own line: the user's running background jobs (`core.job.list`, kept live by SSE). */
export const coreJobsStatus: StatusItemContribution = {
  id: 'core.jobs',
  order: 0,
  useStatus() {
    const { data } = useQuery(coreJobListOptions({ query: { status: 'running', limit: 20 } }))
    const jobs = data?.items ?? []
    const [only] = jobs.length === 1 ? jobs : []
    const progress = useSmoothedProgress(only?.progress ?? 0, only != null)
    if (only) return { icon: LoaderCircle, label: jobStageLabel(only), progress }
    if (jobs.length === 0) return null
    return { icon: LoaderCircle, label: m.status_jobs_running({ count: jobs.length }) }
  },
}

function StatusLine({ item }: { item: StatusItem }) {
  const Icon = item.icon
  const body = (
    <>
      <span className="flex items-center gap-2">
        <Icon
          aria-hidden="true"
          className={cn(
            'size-3.5 shrink-0',
            item.tone === 'error'
              ? 'text-destructive'
              : item.tone === 'success'
                ? 'text-success'
                : 'text-muted-foreground',
          )}
        />
        <span className="truncate">{item.label}</span>
      </span>
      {item.progress != null ? (
        <Progress
          value={item.progress}
          aria-label={item.label}
          className={cn(
            'mt-1 [&_[data-slot=progress-track]]:h-0.5',
            item.tone === 'error' && '[&_[data-slot=progress-indicator]]:bg-destructive',
            item.tone === 'success' && '[&_[data-slot=progress-indicator]]:bg-success',
          )}
        />
      ) : null}
    </>
  )
  return (
    <li className="text-xs">
      {item.to ? (
        <Link to={item.to} className="block rounded-md px-2 py-1 hover:bg-muted">
          {body}
        </Link>
      ) : (
        <div className="px-2 py-1">{body}</div>
      )}
    </li>
  )
}

function Contribution({ contribution }: { contribution: StatusItemContribution }) {
  // Keyed by id, so each instance always calls the same contribution's hook.
  // oxlint-disable-next-line react/rules-of-hooks
  const item = contribution.useStatus()
  return item ? <StatusLine item={item} /> : null
}

/** Bottom of the sidebar (M10 places it). Takes no space while every line is empty. */
export function StatusBar({ className }: { className?: string }) {
  const items = [coreJobsStatus, ...useStatusItems()]
  return (
    <ul aria-label={m.status_bar_label()} className={cn('space-y-0.5 empty:hidden', className)}>
      {items.map((contribution) => (
        <Contribution key={contribution.id} contribution={contribution} />
      ))}
    </ul>
  )
}
