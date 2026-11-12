import {
  type ImportStarted,
  lmsAssignmentAddToGradebook,
  lmsAssignmentImport,
} from '@semestra/api-client'
import { openImport } from '@/modules/imports/launcher'
import { m } from '@/paraglide/messages'

/**
 * Imports picked assignments (M09 §4): the ones worth points into the gradebook, each with its
 * to-do, the others as to-dos. Nothing is written until the user has been through the import
 * review (category, weight and type can be changed there). `provider` names the platform in the
 * review's title.
 */
export async function importAssignments(courseId: string, externalIds: string[], provider: string) {
  const { data } = await lmsAssignmentImport({
    path: { course_id: courseId },
    body: { external_ids: externalIds },
    throwOnError: true,
  })
  return review(data, provider)
}

/** "Add to gradebook" for assignments imported as to-dos: each keeps its to-do. */
export async function addToGradebook(courseId: string, externalIds: string[], provider: string) {
  const { data } = await lmsAssignmentAddToGradebook({
    path: { course_id: courseId },
    body: { external_ids: externalIds },
    throwOnError: true,
  })
  return review(data, provider)
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

function review(started: ImportStarted, provider: string) {
  return openImport({
    programId: started.program_id,
    mode: 'direct',
    source: 'session',
    sessionId: started.session_id,
    title: () => m.lms_import_assignments_from({ provider }),
  })
}
