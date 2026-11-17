import type { PendingOrganizeList } from '@semestra/api-client'
import { filesOrganizationListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { FolderInput } from 'lucide-react'
import type { StatusItem } from '@/app/extensions'
import { m } from '@/paraglide/messages'

/** A course's files with the organizing dialog open (`useOrganizeOpen`). */
export function organizeLink(result: Record<string, unknown> | null | undefined) {
  if (typeof result?.program_id !== 'string' || typeof result.course_id !== 'string') return
  return `/p/${result.program_id}/c/${result.course_id}/files?organize=1`
}

const NONE: PendingOrganizeList['items'] = []

/**
 * The organizing's line in the status bar (M07 §8): shown while a read plan waits to be applied or
 * discarded, from any page of the Program, and leads back to its review.
 */
export function useOrganizeLine(): StatusItem | null {
  const { programId } = useParams({ strict: false }) as { programId?: string }
  const pending = useQuery({
    ...filesOrganizationListOptions({ path: { program_id: programId ?? '' } }),
    enabled: programId !== undefined,
  })
  const waiting = (pending.data?.items ?? NONE).filter((plan) => plan.count > 0)
  const [first] = waiting
  if (!programId || !first) return null
  return {
    icon: FolderInput,
    tone: 'accent',
    rank: 'attention',
    label:
      waiting.length > 1
        ? m.files_organize_line_courses({ count: waiting.length })
        : m.files_organize_line({ count: first.count }),
    to: organizeLink({ program_id: programId, course_id: first.course_id }),
  }
}
