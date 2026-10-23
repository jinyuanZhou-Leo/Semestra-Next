import { lmsAssignmentImport } from '@semestra/api-client'
import { openImport } from '@/modules/imports/launcher'

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

/** Opens the review of a started import (committing it refetches everything, M08). */
export async function reviewAssignmentImport({
  programId,
  sessionId,
  title,
}: {
  programId: string
  sessionId: string
  title: () => string
}) {
  await openImport({ programId, mode: 'direct', source: 'session', sessionId, title })
}
