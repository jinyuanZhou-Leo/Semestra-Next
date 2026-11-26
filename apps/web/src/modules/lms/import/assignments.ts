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

/**
 * Starts the import from inside the import dialog (the gradebook's picker): its session id. New
 * assignments are imported; ones already to-dos go into the gradebook ("Add to gradebook"). Both
 * land in the course's one unfinished import, so the review lists them together.
 */
export async function startAssignmentImport(
  courseId: string,
  externalIds: string[],
  toGradebook: string[],
) {
  let sessionId: string | null = null
  if (externalIds.length > 0) {
    const { data } = await lmsAssignmentImport({
      path: { course_id: courseId },
      body: { external_ids: externalIds },
      throwOnError: true,
    })
    sessionId = data.session_id
  }
  if (toGradebook.length > 0) {
    const { data } = await lmsAssignmentAddToGradebook({
      path: { course_id: courseId },
      body: { external_ids: toGradebook },
      throwOnError: true,
    })
    sessionId = data.session_id
  }
  if (sessionId === null) throw new Error('nothing picked')
  return sessionId
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
