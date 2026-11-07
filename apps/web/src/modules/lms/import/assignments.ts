import {
  type ImportStarted,
  lmsAssignmentAddToGradebook,
  lmsAssignmentImport,
} from '@semestra/api-client'
import { reviewIfNeeded } from '@/modules/imports/entries'
import { m } from '@/paraglide/messages'

/**
 * Imports picked assignments (M09 §4): the ones worth points into the gradebook, each with its
 * to-do, the others as to-dos. Saved at once unless something needs a decision, which opens the
 * review. `provider` names the platform in the review's title.
 */
export async function importAssignments(courseId: string, externalIds: string[], provider: string) {
  const { data } = await lmsAssignmentImport({
    path: { course_id: courseId },
    body: { external_ids: externalIds },
    throwOnError: true,
  })
  return finish(data, externalIds.length, provider)
}

/** "Add to gradebook" for assignments imported as to-dos: each keeps its to-do. */
export async function addToGradebook(courseId: string, externalIds: string[], provider: string) {
  const { data } = await lmsAssignmentAddToGradebook({
    path: { course_id: courseId },
    body: { external_ids: externalIds },
    throwOnError: true,
  })
  return finish(data, externalIds.length, provider)
}

/** Starts the import from inside the import dialog (the gradebook's picker): its session id. */
export async function startAssignmentImport(courseId: string, externalIds: string[]) {
  const { data } = await lmsAssignmentImport({
    path: { course_id: courseId },
    body: { external_ids: externalIds },
    throwOnError: true,
  })
  return data.session_id
}

function finish(started: ImportStarted, count: number, provider: string) {
  return reviewIfNeeded({
    programId: started.program_id,
    sessionId: started.session_id,
    committed: Boolean(started.committed) && !started.failed,
    saved: () => m.imports_saved({ count }),
    title: () => m.lms_import_assignments_from({ provider }),
  })
}
