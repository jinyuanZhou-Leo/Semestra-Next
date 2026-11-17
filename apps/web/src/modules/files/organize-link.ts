import type { JobOut, PendingOrganize } from '@semestra/api-client'
import { filesOrganizationListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { CircleAlert, FolderInput, LoaderCircle } from 'lucide-react'
import { type StatusItem, preloadable } from '@/app/extensions'
import { useJob } from '@/hooks/use-job'
import { m } from '@/paraglide/messages'

/** A course's files with the organizing dialog open (`useOrganizeOpen`). */
export function organizeLink(result: Record<string, unknown> | null | undefined) {
  if (typeof result?.program_id !== 'string' || typeof result.course_id !== 'string') return
  return `/p/${result.program_id}/c/${result.course_id}/files?organize=1`
}

export type OrganizeStage = 'failed' | 'ready' | 'reading'

const ENDED = new Set<JobOut['status']>(['failed', 'cancelled'])

/** Where one course's organizing stands: reading, failed (not yet seen), or waiting for review. */
export function organizeStage(item: PendingOrganize): OrganizeStage | null {
  if (item.job) return ENDED.has(item.job.status) ? 'failed' : 'reading'
  return (item.count ?? 0) > 0 ? 'ready' : null
}

export function organizeStageText(item: PendingOrganize) {
  const stage = organizeStage(item)
  if (stage === 'failed') return m.files_organize_state_failed()
  if (stage === 'ready') return m.files_organize_state_ready({ count: item.count ?? 0 })
  return m.files_organize_state_reading()
}

const ORDER: Record<OrganizeStage, number> = { failed: 0, ready: 1, reading: 2 }
const NONE: PendingOrganize[] = []

/** The Program's organizing that shows on the status line, what waits for the user first. */
export function useOrganizing(programId: string | undefined) {
  const list = useQuery({
    ...filesOrganizationListOptions({ path: { program_id: programId ?? '' } }),
    enabled: programId !== undefined,
  })
  return (list.data?.items ?? NONE)
    .filter((item) => organizeStage(item) !== null)
    .toSorted((a, b) => ORDER[organizeStage(a) ?? 'reading'] - ORDER[organizeStage(b) ?? 'reading'])
}

const OrganizePanel = preloadable<{ onClose: () => void }>(
  () => import('./components/OrganizePanel'),
)

/**
 * The organizing's line in the status bar (M07 §8): one line from the start of the reading to
 * the review, until the plan is applied or discarded (a failure until it has been seen). One
 * course leads straight to its dialog; several open a panel that lists them.
 */
export function useOrganizeLine(): StatusItem | null {
  const { programId } = useParams({ strict: false }) as { programId?: string }
  const items = useOrganizing(programId)
  const [first] = items
  // The reading's progress, followed live.
  const live = useJob(first?.job?.id ?? null, first?.job ?? undefined)
  if (!programId || !first) return null
  const stage = live.status && ENDED.has(live.status) ? 'failed' : organizeStage(first)
  const look =
    stage === 'failed'
      ? ({ icon: CircleAlert, tone: 'error', rank: 'error' } as const)
      : stage === 'ready'
        ? ({ icon: FolderInput, tone: 'accent', rank: 'attention' } as const)
        : ({ icon: LoaderCircle, spin: true, rank: 'running' } as const)
  if (items.length > 1) {
    return {
      ...look,
      label: m.files_organize_line_courses({ count: items.length }),
      Panel: OrganizePanel,
    }
  }
  const text = stage === 'failed' ? m.files_organize_state_failed() : organizeStageText(first)
  return {
    ...look,
    label: `${m.files_organize_title()} · ${text}`,
    progress: stage === 'reading' ? live.progress : undefined,
    to: organizeLink({ program_id: programId, course_id: first.course_id }),
  }
}
