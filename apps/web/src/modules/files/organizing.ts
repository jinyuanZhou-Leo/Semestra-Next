import type { JobOut, PendingOrganize } from '@semestra/api-client'
import { filesOrganizationListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { m } from '@/paraglide/messages'
import { courseFilesPath } from './location'

/** A course's files with the organizing dialog open (`useOrganizeOpen`). */
export function organizeLink(result: Record<string, unknown> | null | undefined) {
  if (typeof result?.program_id !== 'string' || typeof result.course_id !== 'string') return
  return courseFilesPath(result.program_id, result.course_id, { organize: true })
}

export type OrganizeStage = 'failed' | 'ready' | 'reading'

export const ENDED = new Set<JobOut['status']>(['failed', 'cancelled'])

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
