import type { ProcessingFile, ProcessingList } from '@semestra/api-client'
import { filesProcessingListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Clock3, FileText } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'
import { type StatusItem, preloadable } from '@/app/extensions'
import { useUiPref } from '@/app/ui-pref'
import { jobIsWaiting } from '@/hooks/use-job'
import { useNow } from '@/hooks/use-now'
import { m } from '@/paraglide/messages'

/** The id of the line, for `openStatusPanel`. */
export const PROCESSING_LINE = 'files.processing'

/** How long the line says "done" after the last file ended well. */
export const DONE_VISIBLE_MS = 15_000

/** How long ended files stay while the panel is open. */
const HELD_MS = 10 * 60_000

const SEEN_KEY = 'files.processing_seen_failures'

const ProcessingPanel = preloadable<{ onClose: () => void }>(
  () => import('./components/ProcessingPanel'),
)

const ACTIVE = new Set(['pending', 'running'])

export const isActive = (file: ProcessingFile) => ACTIVE.has(file.job.status)

const endedAgo = (file: ProcessingFile, now: number) =>
  file.job.finished_at ? now - new Date(file.job.finished_at).getTime() : Number.POSITIVE_INFINITY

/** Whether the panel is open: while it is, nothing in the line comes or goes under the user. */
const open = {
  value: false,
  /** The failures the open panel lists. */
  failures: [] as readonly string[],
  listeners: new Set<() => void>(),
  set(value: boolean) {
    open.value = value
    for (const listener of open.listeners) listener()
  },
  subscribe(listener: () => void) {
    open.listeners.add(listener)
    return () => void open.listeners.delete(listener)
  },
}

export const setPanelOpen = (value: boolean) => open.set(value)

export const showFailures = (ids: readonly string[]) => {
  open.failures = ids
}

export function processingOptions() {
  return filesProcessingListOptions()
}

/** Failures the panel has shown: the line stops reporting them once its panel has closed. */
export function useSeenFailures() {
  return useUiPref<string[]>(SEEN_KEY, [])
}

/**
 * What the line and its panel show: the files still to read, the ones of this round that ended,
 * and failures not seen yet. A file that ended well stays for `DONE_VISIBLE_MS` once nothing is
 * left to do.
 */
export function shownFiles(
  list: ProcessingList | undefined,
  seen: readonly string[],
  now: number,
  /** The panel is open: what it showed when it opened stays (for a few minutes). */
  held = false,
) {
  const files = list?.files ?? []
  const since = list?.since ? new Date(list.since).getTime() : null
  const inRound = (file: ProcessingFile) =>
    since !== null && new Date(file.job.created_at).getTime() >= since
  const active = files.filter(isActive)
  const failed = files.filter(
    (file) =>
      (file.job.status === 'failed' || (file.job.status === 'cancelled' && inRound(file))) &&
      (inRound(file) || !seen.includes(file.job.id)),
  )
  const done = files.filter(
    (file) =>
      file.job.status === 'succeeded' &&
      (inRound(file) ||
        (since === null && endedAgo(file, now) < (held ? HELD_MS : DONE_VISIBLE_MS))),
  )
  return { active, failed, done }
}

/**
 * The status line of reading files (M07 §3.1): every file being read, uploaded or synced, as
 * one line ("Processing files 3/12"); its panel lists each file with its state, and stops or
 * retries it. The bar under the line shows only while a file the user added is being read: a
 * sync's files are read quietly, with the spinner and the count.
 */
export function useProcessingLine(): StatusItem | null {
  const list = useQuery(processingOptions()).data
  const [seen, setSeen] = useSeenFailures()
  const held = useSyncExternalStore(open.subscribe, () => open.value)
  // The panel has closed: what it listed has been seen.
  useEffect(() => {
    if (held || open.failures.length === 0) return
    setSeen([...new Set([...open.failures, ...seen])].slice(0, 200))
    open.failures = []
  }, [held, seen, setSeen])
  const now = useNow(1000, (at) =>
    (list?.files ?? []).some(
      (file) => file.job.status === 'succeeded' && endedAgo(file, at) < DONE_VISIBLE_MS,
    ),
  )
  const { active, failed, done } = shownFiles(list, seen, now, held)
  const line = { icon: FileText, label: m.files_processing_title(), Panel: ProcessingPanel }
  const unseen = failed.filter((file) => file.job.status === 'failed')
  if (list && list.active > 0) {
    const total = list.active + list.done
    const own = active.some((file) => !file.synced)
    const waiting = active.every((file) => jobIsWaiting(file.job))
    return {
      ...line,
      rank: 'running',
      icon: waiting ? Clock3 : FileText,
      spin: !waiting,
      meta: `${list.done}/${total}`,
      progress: own ? (list.done / total) * 100 : undefined,
      hint:
        unseen.length > 0 ? m.files_processing_hint_failed({ count: unseen.length }) : undefined,
    }
  }
  if (unseen.length > 0) {
    return {
      ...line,
      rank: 'error',
      icon: CircleAlert,
      tone: 'error',
      meta: m.files_processing_meta_failed({ count: unseen.length }),
    }
  }
  if (done.length > 0 || (held && failed.length > 0)) {
    return {
      ...line,
      rank: 'running',
      icon: CircleCheck,
      tone: 'success',
      meta: m.files_processing_meta_done(),
    }
  }
  return null
}
