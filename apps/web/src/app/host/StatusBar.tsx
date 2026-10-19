import type { JobOut } from '@semestra/api-client'
import { coreJobCancel } from '@semestra/api-client'
import { coreJobListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CircleAlert, CircleCheck, LoaderCircle, X } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { JobProgress } from '@/components/JobProgress'
import { jobStageLabel } from '@/hooks/use-job'
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

/** One entry per job, newest first (ids are time-ordered). */
export function mergeJobs(...lists: (readonly JobOut[] | undefined)[]): JobOut[] {
  const byId = new Map<string, JobOut>()
  for (const list of lists)
    for (const job of list ?? []) if (!byId.has(job.id)) byId.set(job.id, job)
  return [...byId.values()].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
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
function LineProgress({ label, tone, progress }: StatusItem) {
  if (progress == null) return null
  return (
    <div className="px-3 pb-1 group-data-[collapsible=icon]:hidden">
      <Progress
        value={progress}
        aria-label={label}
        className={cn(
          '[&_[data-slot=progress-track]]:h-0.5',
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
 * each job belongs. Finished jobs stay ~3 s; failures stay until the list has been opened.
 */
function JobsLine() {
  const { state, isMobile } = useSidebar()
  // Every active job (however many finished after it), plus the newest finished ones.
  const recent = useQuery(coreJobListOptions({ query: { limit: 20 } })).data?.items
  const running = useQuery(coreJobListOptions({ query: { status: 'running', limit: 50 } })).data
    ?.items
  const pending = useQuery(coreJobListOptions({ query: { status: 'pending', limit: 50 } })).data
    ?.items
  const [seen, setSeen] = useUiPref<string[]>(SEEN_KEY, [])
  const [open, setOpen] = useState(false)
  const kinds = useModules().flatMap((module) => module.jobKinds ?? [])
  const all = mergeJobs(recent, running, pending)
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

  // Failures count as seen once the list that showed them closes (not on open: they would
  // vanish, and the list with them, while the user reads them).
  const close = () => {
    markSeen()
    setOpen(false)
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

  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <PopoverTrigger render={<SidebarMenuButton tooltip={item.label} size="sm" />}>
          <LineFace {...item} />
        </PopoverTrigger>
        <PopoverContent
          side={state === 'collapsed' && !isMobile ? 'right' : 'top'}
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
