import type { JobOut } from '@semestra/api-client'
import { coreJobCancel } from '@semestra/api-client'
import { coreJobListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CircleAlert, CircleCheck, Clock3, LoaderCircle, X } from 'lucide-react'
import { Fragment, useState } from 'react'
import { JobProgress } from '@/components/JobProgress'
import { jobIsWaiting, jobStageLabel } from '@/hooks/use-job'
import { useNow } from '@/hooks/use-now'
import { useSmoothedProgress } from '@/hooks/use-smoothed-progress'
import { toastError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemFooter,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@/ui/item'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Progress } from '@/ui/progress'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/ui/sidebar'
import { Spinner } from '@/ui/spinner'
import type { JobKindContribution, StatusItem, StatusItemContribution } from '../extensions'
import { useModules, useStatusItems } from '../registry'
import { useUiPref } from '../ui-pref'

/** How long a finished job stays in the bar. */
export const DONE_VISIBLE_MS = 15_000
/** Failed jobs older than this are no longer shown, seen or not. */
const FAILED_VISIBLE_MS = 7 * 24 * 3600 * 1000
const SEEN_KEY = 'layout.status_seen_failures'

const ACTIVE = new Set(['pending', 'running'])

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

/** The icon and text of a line; the text is clipped (never wrapped) while the rail narrows. */
function LineFace({ icon: Icon, label, tone, spin }: StatusItem & { spin?: boolean }) {
  const iconClass = cn(
    tone === 'error'
      ? 'text-destructive'
      : tone === 'success'
        ? 'text-success'
        : 'text-muted-foreground',
  )
  return (
    <>
      {spin ? (
        <Spinner aria-hidden className={cn(iconClass, 'motion-reduce:animate-none')} />
      ) : (
        <Icon aria-hidden="true" className={iconClass} />
      )}
      <span>{label}</span>
    </>
  )
}

/** The thin progress bar under a line; hidden on the icon rail. */
function LineProgress({ label, tone, progress, waiting }: StatusItem & { waiting?: boolean }) {
  if (progress == null) return null
  return (
    <div className="px-3 pb-1 group-data-[collapsible=icon]:hidden">
      <Progress
        value={progress}
        aria-label={label}
        className={cn(
          '[&_[data-slot=progress-track]]:h-0.5',
          waiting && '[&_[data-slot=progress-indicator]]:bg-muted-foreground/40',
          tone === 'error' && '[&_[data-slot=progress-indicator]]:bg-destructive',
          tone === 'success' && '[&_[data-slot=progress-indicator]]:bg-success',
        )}
      />
    </div>
  )
}

function StatusLine({ item }: { item: StatusItem }) {
  return (
    <SidebarMenuItem>
      {item.to ? (
        <SidebarMenuButton tooltip={item.label} size="sm" render={<Link to={item.to} />}>
          <LineFace {...item} />
        </SidebarMenuButton>
      ) : (
        <SidebarMenuButton
          tooltip={item.label}
          size="sm"
          className="cursor-default"
          render={<div />}
        >
          <LineFace {...item} />
        </SidebarMenuButton>
      )}
      <LineProgress {...item} />
    </SidebarMenuItem>
  )
}

function Contribution({ contribution }: { contribution: StatusItemContribution }) {
  // Keyed by id, so each instance always calls the same contribution's hook.
  // oxlint-disable-next-line react/rules-of-hooks
  const item = contribution.useStatus()
  return item ? <StatusLine item={item} /> : null
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
    <Item render={<li />} size="xs" className="gap-1.5 px-0">
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full">
          {to ? (
            <Link to={to} onClick={onNavigate} className="truncate hover:underline">
              {title}
            </Link>
          ) : (
            <span className="truncate">{title}</span>
          )}
        </ItemTitle>
      </ItemContent>
      {ACTIVE.has(job.status) ? (
        <ItemActions>
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
        </ItemActions>
      ) : null}
      <ItemFooter className="block">
        <JobProgress jobId={job.id} job={job} />
      </ItemFooter>
    </Item>
  )
}

/**
 * The host's own line (M10 §5.6): the user's background jobs. One job shows its stage and
 * progress, several a count; clicking opens the list with progress, cancel and a link to where
 * each job belongs. Finished jobs stay ~15 s (and while the list is open); failures stay until
 * the list has been opened.
 */
function JobsLine() {
  const { state } = useSidebar()
  // The newest jobs, plus every active one however many finished after it.
  const all =
    useQuery(coreJobListOptions({ query: { limit: 20, with_active: true } })).data?.items ?? []
  const [seen, setSeen] = useUiPref<string[]>(SEEN_KEY, [])
  const [open, setOpen] = useState(false)
  // Jobs the list showed when it opened: none of them vanishes under the user while it is open.
  const [held, setHeld] = useState<readonly string[]>([])
  const kinds = useModules().flatMap((module) => module.jobKinds ?? [])
  const now = useNow(500, (at) =>
    all.some((job) => job.status === 'succeeded' && finishedAgo(job, at) < DONE_VISIBLE_MS),
  )
  const shown = visibleJobs(all, seen, now)
  const jobs = open ? all.filter((job) => shown.includes(job) || held.includes(job.id)) : shown
  const active = jobs.filter((job) => ACTIVE.has(job.status))
  const waiting = active.filter(jobIsWaiting).length
  const failed = jobs.filter((job) => job.status === 'failed').length
  const [only] = jobs.length === 1 ? jobs : []
  const onlyWaits = only !== undefined && jobIsWaiting(only)
  const progress = useSmoothedProgress(
    only?.progress ?? 0,
    only?.status === 'running' && !onlyWaits,
  )

  // Already-gone failures need not be remembered; keep the list short.
  const markSeen = () => {
    const ids = jobs.filter((job) => job.status === 'failed').map((job) => job.id)
    if (ids.length > 0) setSeen([...ids, ...seen].slice(0, 50))
  }

  // Failures count as seen once the list that showed them closes (not on open: they would
  // vanish, and the list with them, while the user reads them).
  const close = () => {
    markSeen()
    setOpen(false)
  }

  if (jobs.length === 0) return null

  let item: StatusItem & { spin?: boolean; waiting?: boolean }
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
  } else if (only && onlyWaits) {
    item = {
      icon: Clock3,
      label: m.status_job_waiting({ name: jobTitle(only, kinds) }),
      // A queued job has not started: no bar yet.
      progress: only.status === 'running' ? progress : undefined,
      waiting: true,
    }
  } else if (only) {
    item = {
      icon: LoaderCircle,
      spin: true,
      label: `${jobStageLabel(only)} · ${Math.round(progress)}%`,
      progress,
    }
  } else if (active.length > 0 && waiting === active.length) {
    item = { icon: Clock3, label: m.status_jobs_waiting({ count: waiting }) }
  } else if (active.length > 0) {
    item = {
      icon: LoaderCircle,
      spin: true,
      label:
        waiting > 0
          ? m.status_jobs_running_waiting({ running: active.length - waiting, waiting })
          : m.status_jobs_running({ count: active.length }),
    }
  } else if (failed > 0) {
    item = { icon: CircleAlert, tone: 'error', label: m.status_jobs_failed({ count: failed }) }
  } else {
    // Several jobs that all ended well (or were stopped while the list was open).
    item = { icon: CircleCheck, tone: 'success', label: m.status_jobs_done({ count: jobs.length }) }
  }

  return (
    <SidebarMenuItem>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next) return close()
          setHeld(jobs.map((job) => job.id))
          setOpen(true)
        }}
      >
        <PopoverTrigger render={<SidebarMenuButton tooltip={item.label} size="sm" />}>
          <LineFace {...item} />
        </PopoverTrigger>
        <PopoverContent
          side={state === 'collapsed' ? 'right' : 'top'}
          align="start"
          className="w-80"
        >
          <p className="text-xs font-medium text-muted-foreground">{m.status_jobs_title()}</p>
          <ItemGroup className="gap-0">
            {jobs.map((job, index) => (
              <Fragment key={job.id}>
                {index > 0 ? <ItemSeparator className="my-0" /> : null}
                <JobRow job={job} kinds={kinds} onNavigate={close} />
              </Fragment>
            ))}
          </ItemGroup>
        </PopoverContent>
      </Popover>
      <LineProgress {...item} />
    </SidebarMenuItem>
  )
}

/**
 * Bottom of the sidebar, above settings and the account menu (M10 §5.6): background jobs, then
 * the modules' `statusItems` by `order`. It is a sidebar menu, so the icon rail shows icons only,
 * with the text as a tooltip. Takes no space while every line is empty.
 */
export function StatusBar({ className }: { className?: string }) {
  const items = useStatusItems()
  return (
    <SidebarMenu aria-label={m.status_bar_label()} className={cn('empty:hidden', className)}>
      <JobsLine />
      {items.map((contribution) => (
        <Contribution key={contribution.id} contribution={contribution} />
      ))}
    </SidebarMenu>
  )
}
