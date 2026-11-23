import type {
  AssignmentDetail,
  AssignmentOut,
  AssignmentTarget,
  AssignmentTargets,
} from '@semestra/api-client'
import {
  lmsAssignmentGetOptions,
  lmsAssignmentTargetsOptions,
} from '@semestra/api-client/react-query'
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'

/** The assignment as the details show it. */
export type Assignment = AssignmentDetail['assignment']

/** How the details name a quiz by its own id (what a link to a quiz knows). */
export const PRACTICE = 'quiz:'

export const assignmentOptions = (courseId: string, assignmentId: string) =>
  lmsAssignmentGetOptions({ path: { course_id: courseId, assignment_id: assignmentId } })

/** The assignment as a list of the course already read it: shown until the whole of it arrives. */
function listed(
  queryClient: QueryClient,
  courseId: string,
  assignmentId: string,
): AssignmentDetail | undefined {
  const lists = queryClient.getQueriesData<{ items: AssignmentOut[] }>({
    predicate: ({ queryKey }) => {
      const key = queryKey[0] as { _id?: string; path?: { course_id?: string } } | undefined
      // oxlint-disable-next-line no-underscore-dangle -- hey-api's query key field
      return key?._id === 'lmsAssignmentList' && key.path?.course_id === courseId
    },
  })
  for (const [, list] of lists) {
    const found = list?.items.find((a) => a.external_id === assignmentId)
    if (found) {
      const { submission, state, ...assignment } = found
      return {
        provider: '',
        assignment,
        state,
        submission: submission
          ? { external_id: '', assignment_id: assignmentId, ...submission }
          : null,
        assessment: null,
        task: null,
      }
    }
  }
  return undefined
}

/**
 * One assignment, whole (`lms.assignment.get`): opened from a list that has it, the title, the
 * description and the facts show at once (`partial`), the submission and feedback when the read
 * arrives. `quiz:<id>` names a quiz: the server answers with its assignment, or (a practice
 * quiz) with the quiz itself.
 */
export function useAssignment(courseId: string, assignmentId: string) {
  const queryClient = useQueryClient()
  const whole = useQuery({
    ...assignmentOptions(courseId, assignmentId),
    placeholderData: () => listed(queryClient, courseId, assignmentId),
  })
  return {
    data: whole.data,
    /** Only what a list had: the feedback and its places in Semestra are still to come. */
    partial: whole.isPlaceholderData,
    practice: whole.data?.practice ?? false,
    error: whole.error,
    refetch: () => void whole.refetch(),
  }
}

/** Which assignment each of the Program's assessments and to-dos is (M09 §5), read once. */
export const assignmentTargetsOptions = (programId: string) =>
  lmsAssignmentTargetsOptions({ path: { program_id: programId } })

type Of = { taskId?: string | null; assessmentId?: string | null }

/**
 * The platform assignment a to-do or an assessment is, when it is one: a to-do imported as such,
 * or the to-do of an imported assessment.
 */
function targetOf(targets: AssignmentTargets, of: Of): AssignmentTarget | null {
  return (
    targets.items.find(
      (t) =>
        (of.assessmentId != null && t.assessment_id === of.assessmentId) ||
        (of.taskId != null && t.task_id === of.taskId),
    ) ?? null
  )
}

export function assignmentOf(
  targets: AssignmentTargets,
  of: Of,
): { courseId: string; assignmentId: string } | null {
  const found = targetOf(targets, of)
  return found ? { courseId: found.course_id, assignmentId: found.assignment_id } : null
}

export function useAssignmentOf(programId: string, of: Of) {
  return (
    useQuery({
      ...assignmentTargetsOptions(programId),
      enabled: programId !== '',
      select: (targets) => assignmentOf(targets, of),
    }).data ?? null
  )
}

/** The target itself, with whether the teacher left feedback on the assessment. */
export function useAssignmentTarget(programId: string, of: Of) {
  return (
    useQuery({
      ...assignmentTargetsOptions(programId),
      enabled: programId !== '',
      select: (targets) => targetOf(targets, of),
    }).data ?? null
  )
}
