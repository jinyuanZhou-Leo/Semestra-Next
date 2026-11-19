import type { JobOut } from '@semestra/api-client'
import { coreJobListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock3,
  Ellipsis,
  LoaderCircle,
  type LucideIcon,
  X,
} from 'lucide-react'
import {
  Fragment,
  type ReactNode,
  Suspense,
  createContext,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import { PanelIconAction, PanelRow } from '@/components/StatusPanel'
import { jobIsWaiting, jobStageLabel, useJob } from '@/hooks/use-job'
import { useNow } from '@/hooks/use-now'
import { useSmoothedProgress } from '@/hooks/use-smoothed-progress'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Item, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from '@/ui/item'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/ui/popover'
import { Progress } from '@/ui/progress'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/ui/sidebar'
import { Spinner } from '@/ui/spinner'
import {
  type JobKindContribution,
  preload,
  type StatusItem,
  type StatusItemContribution,
  type StatusRank,
} from '../extensions'
import { useModules, useStatusItems } from '../registry'
import { PluginBoundary } from './PluginBoundary'
import { onStatusPanelRequest, openStatusPanel } from './status-panel'
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

/** At most this many lines show; past it the last one sums up the rest (M10 §5.6). */
export const MAX_LINES = 3

const RANKS: Record<StatusRank, number> = { error: 0, attention: 1, running: 2, timer: 3, idle: 4 }

const rankOf = (item: StatusItem) =>
  RANKS[item.rank ?? (item.tone === 'error' ? 'error' : 'running')]

/** What the bar knows of a line to place it, and to name it on the overflow line. */
export type LineEntry = {
  rank: number
  order: number
  label: string
  icon: LucideIcon
  tone?: StatusItem['tone']
  to?: string
  /** It opens a panel: the overflow list opens it in its place. */
  panel?: boolean
  /** It runs `onSelect`: the overflow list runs it too. */
  select?: boolean
}

/**
 * Which lines show, in order: by rank, then `order`. When more want to show than fit, the last
 * place goes to a line that sums up the rest (`hidden`). `pinned` (a line whose panel was asked
 * for) always shows.
 */
export function placeLines(
  entries: ReadonlyMap<string, LineEntry>,
  pinned: string | null = null,
  max = MAX_LINES,
): { shown: string[]; hidden: string[] } {
  const ids = [...entries.keys()].sort((a, b) => {
    const x = entries.get(a)
    const y = entries.get(b)
    if (!x || !y) return 0
    return a === pinned ? -1 : b === pinned ? 1 : x.rank - y.rank || x.order - y.order
  })
  if (ids.length <= max) return { shown: ids, hidden: [] }
  return { shown: ids.slice(0, max - 1), hidden: ids.slice(max - 1) }
}

const same = (a: LineEntry, b: LineEntry) =>
  (Object.keys(a) as (keyof LineEntry)[]).every((key) => a[key] === b[key]) &&
  Object.keys(a).length === Object.keys(b).length

type LinesState = {
  entries: ReadonlyMap<string, LineEntry>
  /** The line whose panel is open, however it was opened or closed. */
  open: string | null
}

/** What each line shows and whether its panel is open, written by the lines, read by the bar. */
class Lines {
  private state: LinesState = { entries: new Map(), open: null }
  private readonly listeners = new Set<() => void>()
  /** Each line's `onSelect`, for the overflow list (not state: nothing renders from it). */
  readonly actions = new Map<string, () => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  get = () => this.state

  private update(next: Partial<LinesState>) {
    this.state = { ...this.state, ...next }
    for (const listener of this.listeners) listener()
  }

  set(id: string, entry: LineEntry | null) {
    const current = this.state.entries.get(id)
    if (entry === null ? current === undefined : current !== undefined && same(current, entry)) {
      return
    }
    const entries = new Map(this.state.entries)
    if (entry) entries.set(id, entry)
    else entries.delete(id)
    this.update({ entries })
  }

  opened(id: string) {
    if (this.state.open !== id) this.update({ open: id })
  }

  closed(id: string) {
    if (this.state.open === id) this.update({ open: null })
  }
}

type Bar = { lines: Lines; shown: readonly string[] }

const BarContext = createContext<Bar | null>(null)

/** The icon and text of a line; the text is clipped (never wrapped) while the rail narrows. */
function LineFace({ icon: Icon, label, tone, spin, meta, badge }: StatusItem) {
  const enter =
    'animate-in duration-200 fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none'
  const iconClass = cn(
    enter,
    tone === 'error'
      ? 'text-destructive'
      : tone === 'success'
        ? 'text-success'
        : tone === 'accent'
          ? 'text-primary'
          : 'text-muted-foreground',
  )
  // One key for the icon and the text together: a new state replaces both and fades in where the
  // old one was, while a label that only counts on ("3 min ago") stays put.
  const key = `${spin ? 'spin' : Icon.displayName}:${tone ?? ''}`
  return (
    <Fragment key={key}>
      {spin ? (
        <Spinner aria-hidden className={cn(iconClass, 'motion-reduce:animate-none')} />
      ) : (
        <Icon aria-hidden="true" className={iconClass} />
      )}
      <span className={cn(enter, 'truncate')}>{label}</span>
      <span
        // A new kind of end (a badge, a state, nothing) fades in; new text in the same kind does not.
        key={`end:${badge ? 'badge' : meta ? 'meta' : ''}`}
        className={cn(
          enter,
          'ml-auto shrink-0 text-xs tabular-nums group-data-[collapsible=icon]:hidden',
          tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {badge ? (
          <Badge className="h-4 min-w-4 px-1 text-[0.625rem] tabular-nums">{badge}</Badge>
        ) : (
          meta
        )}
      </span>
    </Fragment>
  )
}

/**
 * The thin progress bar along the bottom of a line, inside its hover area: the line grows from
 * 32 to 40 px while it shows, so the bar keeps the same inset as the text. Hidden on the icon rail.
 */
function LineProgress({ label, tone, progress, waiting }: StatusItem & { waiting?: boolean }) {
  // Kept at its last value while it fades, so it does not empty before it goes.
  const [last, setLast] = useState(progress)
  if (progress != null && progress !== last) setLast(progress)
  const value = progress ?? last
  if (value == null) return null
  return (
    <div
      aria-hidden={progress == null}
      className={cn(
        'absolute inset-x-3 bottom-2 transition-opacity duration-200 ease-out group-data-[collapsible=icon]:hidden motion-reduce:transition-none',
        progress == null ? 'opacity-0' : 'opacity-100',
      )}
    >
      <Progress
        value={value}
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

const signatureOf = (item: StatusItem | null) =>
  item
    ? [
        item.label,
        item.tone,
        item.rank,
        item.progress,
        item.to,
        item.spin,
        item.meta,
        item.badge,
        item.hint,
      ].join('\u0000')
    : ''

/**
 * One place in the bar. It tells the bar what it shows (`report`), opens and closes with a 200 ms
 * height transition, and keeps its last content while it closes. Its button opens `panel` in a
 * popover, runs `onSelect`, follows `to`, or does nothing.
 */
function Slot({
  id,
  order,
  item,
  panel,
  open = false,
  onOpenChange,
  waiting,
  report = true,
}: {
  id: string
  order: number
  item: StatusItem | null
  panel?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  waiting?: boolean
  report?: boolean
}) {
  const bar = use(BarContext)
  // The store outlives the bar's renders; the effects depend on it, not on the bar object.
  const lines = bar?.lines
  const { state } = useSidebar()
  const rank = item ? rankOf(item) : null
  const { label, icon, tone, to, onSelect } = item ?? {}
  const hasPanel = panel !== undefined
  const select = onSelect !== undefined
  useEffect(() => {
    if (!lines || !report) return
    lines.set(
      id,
      rank !== null && label !== undefined && icon !== undefined
        ? { rank, order, label, icon, tone, to, panel: hasPanel, select }
        : null,
    )
  }, [lines, report, id, rank, order, label, icon, tone, to, hasPanel, select])
  useEffect(() => () => lines?.set(id, null), [lines, id])
  useEffect(() => {
    if (!lines || !onSelect) return
    lines.actions.set(id, onSelect)
    return () => void lines.actions.delete(id)
  }, [lines, id, onSelect])
  // The bar follows `open` itself, so a panel closed by its own buttons or a link counts too.
  useEffect(() => {
    if (!lines || !open) return
    lines.opened(id)
    return () => lines.closed(id)
  }, [lines, id, open])
  useEffect(() => {
    if (!onOpenChange) return
    return onStatusPanelRequest((asked) => {
      if (asked === id) onOpenChange(true)
    })
  }, [id, onOpenChange])

  // What it showed last, kept while it closes (a line that just ended still reads as itself).
  const signature = signatureOf(item)
  const [last, setLast] = useState({ signature, item })
  if (item && signature !== last.signature) setLast({ signature, item })
  const content = item ?? last.item
  const place = report ? (bar?.shown.indexOf(id) ?? -1) : item ? MAX_LINES - 1 : -1
  const shown = place >= 0 && content !== null

  const face = content ? (
    <>
      <LineFace {...content} />
      <LineProgress {...content} waiting={waiting} />
    </>
  ) : null
  // Taller while a bar shows; the text stays in the top 32 px (`pb-4`), centred as before.
  const grow = cn(
    'relative',
    content?.progress != null && 'h-10 pb-4 group-data-[collapsible=icon]:pb-2!',
  )
  // A line that says more than its name (an error's reason) says it on hover, also when open.
  const tooltip = content?.hint ? { children: content.hint, hidden: false } : content?.label
  let button: ReactNode = null
  if (content && panel) {
    button = (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger render={<SidebarMenuButton tooltip={tooltip} size="sm" className={grow} />}>
          {face}
        </PopoverTrigger>
        <PopoverContent
          side={state === 'collapsed' ? 'right' : 'top'}
          align="start"
          className="w-[26rem]"
        >
          <Suspense fallback={<Spinner className="mx-auto" />}>{panel}</Suspense>
        </PopoverContent>
      </Popover>
    )
  } else if (content?.onSelect) {
    button = (
      <SidebarMenuButton tooltip={tooltip} size="sm" className={grow} onClick={content.onSelect}>
        {face}
      </SidebarMenuButton>
    )
  } else if (content?.to) {
    button = (
      <SidebarMenuButton
        tooltip={tooltip}
        size="sm"
        className={grow}
        render={<Link to={content.to} />}
      >
        {face}
      </SidebarMenuButton>
    )
  } else if (content) {
    button = (
      <SidebarMenuButton
        tooltip={tooltip}
        size="sm"
        className={cn(grow, 'cursor-default')}
        render={<div />}
      >
        {face}
      </SidebarMenuButton>
    )
  }

  return (
    <SidebarMenuItem
      data-status-line={id}
      data-shown={shown}
      inert={!shown}
      style={{ order: shown ? place : MAX_LINES }}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
        shown ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="pb-0.5">{button}</div>
      </div>
    </SidebarMenuItem>
  )
}

/** Each contribution's hook, loaded once; a failed load is forgotten so the next mount retries. */
const hooks = new WeakMap<StatusItemContribution, Promise<{ useStatus: () => StatusItem | null }>>()

function loadHook(contribution: StatusItemContribution) {
  let hook = hooks.get(contribution)
  if (!hook) {
    hook = contribution.load().then(
      (useStatus) => ({ useStatus }),
      (error: unknown) => {
        hooks.delete(contribution)
        throw error
      },
    )
    hooks.set(contribution, hook)
  }
  return hook
}

function Contribution({
  contribution,
  order,
}: {
  contribution: StatusItemContribution
  order: number
}) {
  // Keyed by id, so each instance always calls the same contribution's hook.
  const line = use(loadHook(contribution))
  // oxlint-disable-next-line react/rules-of-hooks
  const item = line.useStatus()
  const [open, setOpen] = useState(false)
  const Panel = item?.Panel
  // Loaded with the line, so opening it does not wait.
  useEffect(() => void preload(Panel), [Panel])
  return (
    <Slot
      id={contribution.id}
      order={order}
      item={item}
      open={open}
      onOpenChange={Panel ? setOpen : undefined}
      panel={Panel ? <Panel onClose={() => setOpen(false)} /> : undefined}
    />
  )
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
  // Live over SSE, seeded with the listed state.
  const live = useJob(job.id, job)
  const current = live.job ?? job
  const kind = kinds.find((k) => k.kind === job.kind)
  const to = kind?.to?.(current)
  const title = jobTitle(current, kinds)
  const running = current.status === 'running' && !live.waiting
  const look =
    current.status === 'failed'
      ? ({
          icon: CircleAlert,
          tone: 'error',
          detail: errorMessage({ error: { code: current.error_code ?? 'unknown' } }),
        } as const)
      : current.status === 'succeeded'
        ? ({ icon: CircleCheck, tone: 'success', detail: m.ai_action_done() } as const)
        : current.status === 'cancelled'
          ? ({ icon: CircleX, detail: m.job_cancelled() } as const)
          : ({ icon: running ? LoaderCircle : Clock3, detail: live.stageLabel } as const)
  return (
    <PanelRow
      icon={look.icon}
      spin={running}
      tone={'tone' in look ? look.tone : undefined}
      title={title}
      detail={look.detail}
      muted={current.status === 'cancelled'}
      time={running ? `${live.progress}%` : undefined}
      href={to}
      onOpen={onNavigate}
    >
      {ACTIVE.has(current.status) ? (
        <PanelIconAction
          label={m.status_job_cancel({ name: title })}
          disabled={live.cancelling}
          onClick={live.cancel}
          className="opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100"
        >
          <X aria-hidden />
        </PanelIconAction>
      ) : null}
    </PanelRow>
  )
}

/**
 * The host's own line (M10 §5.6): the user's background jobs. One job shows its stage and
 * progress, several a count; clicking opens the list with progress, cancel and a link to where
 * each job belongs. Finished jobs stay ~15 s (and while the list is open); failures stay until
 * the list has been opened.
 */
function JobsLine() {
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

  let item: StatusItem | null = null
  if (jobs.length === 0) {
    item = null
  } else if (only && only.status === 'failed') {
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
    <Slot
      id="jobs"
      order={-1}
      item={item}
      waiting={onlyWaits}
      open={open}
      onOpenChange={(next) => {
        if (!next) return close()
        setHeld(jobs.map((job) => job.id))
        setOpen(true)
      }}
      panel={
        <div className="-m-4 flex max-h-[min(36rem,75vh)] flex-col">
          <div className="border-b px-4 py-3">
            <PopoverHeader className="gap-0">
              <PopoverTitle className="text-sm">{m.status_jobs_title()}</PopoverTitle>
              {item ? (
                <PopoverDescription className="text-xs tabular-nums">
                  {item.label}
                </PopoverDescription>
              ) : null}
            </PopoverHeader>
          </div>
          <ItemGroup className="gap-0 overflow-y-auto p-2 has-data-[size=xs]:gap-0">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} kinds={kinds} onNavigate={close} />
            ))}
          </ItemGroup>
        </div>
      }
    />
  )
}

/**
 * The last place when more lines want to show than fit: "N more · names", opening their list.
 * A line there that has a panel opens it in its own place; one with a link follows it.
 */
function MoreLine({ entries }: { entries: readonly (LineEntry & { id: string })[] }) {
  const lines = use(BarContext)?.lines
  const [open, setOpen] = useState(false)
  const names = entries.map((entry) => entry.label).join(m.common_list_separator())
  const item: StatusItem | null =
    entries.length > 0
      ? { icon: Ellipsis, label: m.status_more({ count: entries.length, names }) }
      : null
  return (
    <Slot
      id="more"
      order={0}
      item={item}
      report={false}
      open={open}
      onOpenChange={setOpen}
      panel={
        <>
          <p className="text-xs font-medium text-muted-foreground">{m.status_more_title()}</p>
          <ItemGroup className="gap-0">
            {entries.map(({ id, icon: Icon, label, to, tone, panel, select }, index) => (
              <Fragment key={id}>
                {index > 0 ? <ItemSeparator className="my-0" /> : null}
                <Item render={<li />} size="xs" className="gap-2 px-0">
                  <Icon
                    aria-hidden
                    className={cn(
                      'size-4 shrink-0',
                      tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  />
                  <ItemContent className="min-w-0">
                    <ItemTitle className="w-full">
                      {select ? (
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false)
                            lines?.actions.get(id)?.()
                          }}
                          className="truncate text-left hover:underline"
                        >
                          {label}
                        </button>
                      ) : to ? (
                        <Link
                          to={to}
                          onClick={() => setOpen(false)}
                          className="truncate hover:underline"
                        >
                          {label}
                        </Link>
                      ) : panel ? (
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false)
                            openStatusPanel(id)
                          }}
                          className="truncate text-left hover:underline"
                        >
                          {label}
                        </button>
                      ) : (
                        <span className="truncate">{label}</span>
                      )}
                    </ItemTitle>
                  </ItemContent>
                </Item>
              </Fragment>
            ))}
          </ItemGroup>
        </>
      }
    />
  )
}

/**
 * Bottom of the sidebar, above settings and the account menu (M10 §5.6): background jobs and the
 * modules' `statusItems`, at most `MAX_LINES`, by rank (errors first). Lines open and close with
 * a height transition, so what is around the bar moves smoothly; while the pointer is over it or
 * a panel is open, nothing comes or goes. It is a sidebar menu, so the icon rail shows icons
 * only, with the text as a tooltip.
 */
export function StatusBar({ className }: { className?: string }) {
  const items = useStatusItems()
  const [lines] = useState(() => new Lines())
  const { entries, open } = useSyncExternalStore(lines.subscribe, lines.get)
  const [pinned, setPinned] = useState<string | null>(null)
  const live = placeLines(entries, pinned)
  const [hovering, setHovering] = useState(false)
  const [frozen, setFrozen] = useState<typeof live | null>(null)
  // Nothing comes or goes while the pointer is over the bar or a panel is open.
  const holding = hovering || open !== null
  if (holding && frozen === null) setFrozen(live)
  if (!holding && frozen !== null) setFrozen(null)
  // A line pinned for its panel goes back to its place once the panel closes.
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open === null) setPinned(null)
  }
  const placement = frozen ?? live

  useEffect(
    () =>
      onStatusPanelRequest((id) => {
        if (!lines.get().entries.get(id)?.panel) return
        setPinned(id)
        // Placed again, with the pinned line in it, when the panel opens.
        setFrozen(null)
      }),
    [lines],
  )

  const bar: Bar = { lines, shown: placement.shown }
  const hidden = placement.hidden.flatMap((id) => {
    const entry = entries.get(id)
    return entry ? [{ ...entry, id }] : []
  })

  return (
    <BarContext value={bar}>
      <SidebarMenu
        aria-label={m.status_bar_label()}
        className={cn('gap-0', className)}
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => setHovering(false)}
      >
        <JobsLine />
        {items.map((contribution) => (
          <PluginBoundary key={contribution.id} silent>
            <Contribution contribution={contribution} order={contribution.order} />
          </PluginBoundary>
        ))}
        <MoreLine entries={hidden} />
      </SidebarMenu>
    </BarContext>
  )
}
