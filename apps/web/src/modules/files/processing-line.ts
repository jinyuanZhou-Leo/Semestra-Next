import type { ProcessingFile, ProcessingList } from '@semestra/api-client'
import { filesProcessingListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, CircleStop, Clock3, FileText } from 'lucide-react'
import { type StatusItem, preloadable } from '@/app/extensions'
import { endedLately, useDoneClock, useSeenFailures } from '@/app/host/status-lifecycle'
import { jobIsWaiting } from '@/hooks/use-job'
import { m } from '@/paraglide/messages'

const ProcessingPanel = preloadable<{ onClose: () => void }>(
  () => import('./components/ProcessingPanel'),
)

const ACTIVE = new Set(['pending', 'running'])

export const isActive = (file: ProcessingFile) => ACTIVE.has(file.job.status)

export function processingOptions() {
  return filesProcessingListOptions()
}

/**
 * What the line and its panel show: the files still to read; the files of the current round that
 * failed or were stopped, and earlier failures not seen yet; and the files of the round that were
 * read. Once nothing is left to do, the line says "done" for a while (`endedLately`).
 */
export function shownFiles(list: ProcessingList | undefined, seen: readonly string[]) {
  const files = list?.files ?? []
  const since = list?.since ? new Date(list.since).getTime() : null
  const inRound = (file: ProcessingFile) =>
    since !== null && new Date(file.job.created_at).getTime() >= since
  const active = files.filter(isActive)
  const failed = files.filter(
    (file) =>
      (file.job.status === 'failed' || file.job.status === 'cancelled') &&
      (inRound(file) || !seen.includes(file.job.id)),
  )
  const done = files.filter((file) => file.job.status === 'succeeded' && inRound(file))
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
  const seen = useSeenFailures()
  const lastEnd = Math.max(
    0,
    ...(list?.files ?? []).map((file) =>
      file.job.finished_at ? new Date(file.job.finished_at).getTime() : 0,
    ),
  )
  const now = useDoneClock([lastEnd])
  const { active, failed, done } = shownFiles(list, seen)
  const line = {
    icon: FileText,
    label: m.files_processing_title(),
    Panel: ProcessingPanel,
    // What the panel lists as failed or stopped is seen once it closes.
    failures: failed.map((file) => file.job.id),
  }
  const unseen = failed.filter((file) => !seen.includes(file.job.id))
  const unseenFailed = unseen.filter((file) => file.job.status === 'failed')
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
        unseenFailed.length > 0
          ? m.files_processing_hint_failed({ count: unseenFailed.length })
          : undefined,
    }
  }
  if (unseenFailed.length > 0) {
    return {
      ...line,
      rank: 'error',
      icon: CircleAlert,
      tone: 'error',
      meta: m.files_processing_meta_failed({ count: unseenFailed.length }),
    }
  }
  if (unseen.length > 0) {
    return {
      ...line,
      rank: 'attention',
      icon: CircleStop,
      meta: m.files_processing_meta_stopped({ count: unseen.length }),
    }
  }
  if (done.length > 0 && endedLately(lastEnd, now)) {
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
