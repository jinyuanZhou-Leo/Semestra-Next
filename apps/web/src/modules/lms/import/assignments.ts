import { lmsAssignmentImport } from '@semestra/api-client'
import type { QueryClient } from '@tanstack/react-query'
import { openImport } from '@/modules/imports/launcher'
import { invalidateLms } from '../queries'

export type AssignmentImportKind = 'assessment' | 'task'

/** Starts the M08 import of picked assignments, into the gradebook or as tasks; its session id. */
export async function startAssignmentImport(
  courseId: string,
  externalIds: string[],
  kind: AssignmentImportKind,
): Promise<string> {
  const { data } = await lmsAssignmentImport({
    path: { course_id: courseId },
    body: { external_ids: externalIds, as_kind: kind },
    throwOnError: true,
  })
  return data.session_id
}

/** Opens the review of a started import; the course's LMS reads refetch once it closes. */
export async function reviewAssignmentImport(
  queryClient: QueryClient,
  {
    programId,
    courseId,
    sessionId,
    title,
  }: {
    programId: string
    courseId: string
    sessionId: string
    title: () => string
  },
) {
  await openImport({ programId, mode: 'direct', source: 'session', sessionId, title })
  await invalidateLms(queryClient, { courseId })
}
