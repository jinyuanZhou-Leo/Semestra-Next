import type { JobOut } from '@semestra/api-client'
import { coreJobCancel } from '@semestra/api-client'
import { coreJobListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CircleAlert, CircleCheck, LoaderCircle, X } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { JobProgress } from '@/components/JobProgress'
import { ProgressBar } from '@/components/Progress'
import { jobStageLabel } from '@/hooks/use-job'
import { useSmoothedProgress } from '@/hooks/use-smoothed-progress'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import type { JobKindContribution, StatusItem, StatusItemContribution } from '../extensions'
import { useModules, useStatusItems } from '../registry'
import { useUiPref } from '../ui-pref'

/** How long a finished job stays in the bar. */
export const DONE_VISIBLE_MS = 3000
/** Failed jobs older than this are no longer shown, seen or not. */
const FAILED_VISIBLE_MS = 7 * 24 * 3600 * 1000
const SEEN_KEY = 'layout.status_seen_failures'

const ACTIVE = new Set(['pending', 'running'])

/** The current time, ticking while `tick(now)` holds (a finished job is waiting to go away). */
function useNow(tick: (now: number) => boolean): number {
  const [now, setNow] = useState(() => Date.now())
  const ticking = tick(now)
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [ticking])
  return now
}

function finishedAgo(job: JobOut, now: number): number {
  return job.finished_at ? now - new Date(job.finished_at).getTime() : Number.POSITIVE_INFINITY
}

/** Jobs the bar shows: running ones, ones that just succeeded, and failures not looked at yet. */
export function visibleJobs(jobs: readonly JobOut[], seen: readonly string[], now: number) {
  return jobs.filter(
    (job) =>
      ACTIVE.has(job.status) ||
      (job.status === 'succeeded' && finishedAgo(job, now) < DONE_VISIBLE_MS) ||
      (job.status === 'failed' &&
        !seen.includes(job.id) &&
        finishedAgo(job, now) < FAILED_VISIBLE_MS),
  )
}

function jobTitle(job: JobOut, kinds: readonly JobKindContribution[]): string {
  return kinds.find((k) => k.kind === job.kind)?.title() ?? jobStageLabel(job)
}

const LINE_CLASS =
  'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

function LineBody({
  icon: Icon,
  label,
  tone,
  progress,
  collapsed,
  spin,
}: StatusItem & { collapsed?: boolean; spin?: boolean }) {
  return (
    <>
      <span className={cn('flex min-w-0 flex-1 items-center gap-2', collapsed && 'justify-center')}>
        <Icon
          aria-hidden="true"
          className={cn(
            'size-3.5 shrink-0',
            spin && 'animate-spin motion-reduce:animate-none',
            tone === 'error'
              ? 'text-destructive'
              : tone === 'success'
                ? 'text-success'
                : 'text-muted-foreground',
          )}
        />
        {collapsed ? (
          <span className="sr-only">{label}</span>
        ) : (
          <span className="truncate">{label}</span>
        )}
      </span>
      {progress != null && !collapsed ? (
        <ProgressBar value={progress} label={label} tone={tone} className="mt-1 h-0.5" />
      ) : null}
    </>
  )
}

function StatusLine({ item, collapsed }: { item: StatusItem; collapsed?: boolean }) {
  const body = <LineBody {...item} collapsed={collapsed} />
  return (
    <li>
      {item.to ? (
        <Link to={item.to} title={item.label} className={cn(LINE_CLASS, 'flex-col items-stretch')}>
          {body}
        </Link>
      ) : (
        <div title={item.label} className="flex flex-col px-2 py-1 text-xs">
          {body}
        </div>
      )}
    </li>
  )
}

function Contribution({
  contribution,
  collapsed,
}: {
  contribution: StatusItemContribution
  collapsed?: boolean
}) {
  // Keyed by id, so each instance always calls the same contribution's hook.
  // oxlint-disable-next-line react/rules-of-hooks
  const item = contribution.useStatus()
  return item ? <StatusLine item={item} collapsed={collapsed} /> : null
}

function JobRow({
  job,
  kinds,
  onNavigate,
}: {
  job: JobOut
  kinds: readonly JobKindContribution[]
  onNavigate: () => void
}) {
  const kind = kinds.find((k) => k.kind === job.kind)
  const to = kind?.to?.(job)
  const title = jobTitle(job, kinds)
  const cancel = async () => {
    try {
      await coreJobCancel({ path: { job_id: job.id }, throwOnError: true })
    } catch (err) {
      toastError(err)
    }
  }
  return (
    <li className="space-y-1.5 py-2">
      <div className="flex items-center gap-2">
        {to ? (
          <Link
            to={to}
            onClick={onNavigate}
            className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
          >
            {title}
          </Link>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        )}
        {ACTIVE.has(job.status) ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={m.status_job_cancel({ name: title })}
            title={m.status_job_cancel({ name: title })}
            disabled={job.cancel_requested}
            onClick={() => void cancel()}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
      <JobProgress jobId={job.id} job={job} />
    </li>
  )
}

/**
 * The host's own line (M10 §5.6): the user's background jobs. One job shows its stage and
 * progress, several a count; clicking opens the list with progress, cancel and a link to where
 * each job belongs. Finished jobs stay ~3 s; failures stay until the list has been opened.
 */
function JobsLine({ collapsed }: { collapsed?: boolean }) {
  const { data } = useQuery(coreJobListOptions({ query: { limit: 20 } }))
  const [seen, setSeen] = useUiPref<string[]>(SEEN_KEY, [])
  const [open, setOpen] = useState(false)
  const kinds = useModules().flatMap((module) => module.jobKinds ?? [])
  const all = data?.items ?? []
  const now = useNow((at) =>
    all.some((job) => job.status === 'succeeded' && finishedAgo(job, at) < DONE_VISIBLE_MS),
  )
  const jobs = visibleJobs(all, seen, now)
  const active = jobs.filter((job) => ACTIVE.has(job.status))
  const [only] = jobs.length === 1 ? jobs : []
  const progress = useSmoothedProgress(only?.progress ?? 0, only?.status === 'running')

  // Already-gone failures need not be remembered; keep the list short.
  const markSeen = () => {
    const failed = jobs.filter((job) => job.status === 'failed').map((job) => job.id)
    if (failed.length > 0) setSeen([...failed, ...seen].slice(0, 50))
  }

  if (jobs.length === 0) return null

  let item: StatusItem & { spin?: boolean }
  if (only && only.status === 'failed') {
    item = {
      icon: CircleAlert,
      tone: 'error',
      label: m.status_job_failed({ name: jobTitle(only, kinds) }),
    }
  } else if (only && only.status === 'succeeded') {
    item = {
      icon: CircleCheck,
      tone: 'success',
      label: m.status_job_done({ name: jobTitle(only, kinds) }),
    }
  } else if (only) {
    item = {
      icon: LoaderCircle,
      spin: true,
      label: `${jobStageLabel(only)} · ${Math.round(progress)}%`,
      progress,
    }
  } else if (active.length > 0) {
    item = {
      icon: LoaderCircle,
      spin: true,
      label: m.status_jobs_running({ count: active.length }),
    }
  } else {
    item = { icon: CircleAlert, tone: 'error', label: m.status_jobs_failed({ count: jobs.length }) }
  }

  const trigger: ReactNode = (
    <PopoverTrigger
      title={item.label}
      aria-label={collapsed ? item.label : undefined}
      className={cn(LINE_CLASS, 'flex-col items-stretch')}
    >
      <LineBody {...item} collapsed={collapsed} />
    </PopoverTrigger>
  )

  return (
    <li>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) markSeen()
        }}
      >
        {trigger}
        <PopoverContent side={collapsed ? 'right' : 'top'} align="start" className="w-80">
          <p className="text-xs font-medium text-muted-foreground">{m.status_jobs_title()}</p>
          <ul className="divide-y divide-border">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} kinds={kinds} onNavigate={() => setOpen(false)} />
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </li>
  )
}

/**
 * Bottom of the sidebar, above settings and the account menu (M10 §5.6): background jobs, then
 * the modules' `statusItems` by `order`. `collapsed` shows icons only, with the text on hover.
 * Takes no space while every line is empty.
 */
export function StatusBar({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  const items = useStatusItems()
  return (
    <ul
      aria-label={m.status_bar_label()}
      className={cn('w-full space-y-0.5 empty:hidden', className)}
    >
      <JobsLine collapsed={collapsed} />
      {items.map((contribution) => (
        <Contribution key={contribution.id} contribution={contribution} collapsed={collapsed} />
      ))}
    </ul>
  )
}
