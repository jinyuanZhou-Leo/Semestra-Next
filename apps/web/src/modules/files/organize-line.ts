import { useParams } from '@tanstack/react-router'
import { CircleAlert, FolderInput, LoaderCircle } from 'lucide-react'
import { type StatusItem, preloadable } from '@/app/extensions'
import { useJob } from '@/hooks/use-job'
import { m } from '@/paraglide/messages'
import { ENDED, organizeLink, organizeStage, organizeStageText, useOrganizing } from './organizing'

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
