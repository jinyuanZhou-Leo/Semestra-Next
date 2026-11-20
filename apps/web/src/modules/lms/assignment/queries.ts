import type { AssignmentDetail, AssignmentOut, Quiz } from '@semestra/api-client'
import {
  lmsAssignmentGetOptions,
  lmsAssignmentTargetsOptions,
  lmsQuizListOptions,
} from '@semestra/api-client/react-query'
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'

/** The assignment as the details show it. */
export type Assignment = AssignmentDetail['assignment']

/** The id the details take for a quiz that is not an assignment (a practice quiz). */
export const PRACTICE = 'quiz:'

export const assignmentOptions = (courseId: string, assignmentId: string) =>
  lmsAssignmentGetOptions({ path: { course_id: courseId, assignment_id: assignmentId } })

/** A practice quiz in the shape of an assignment: no submission, nothing to import. */
function fromQuiz(quiz: Quiz): AssignmentDetail {
  return {
    provider: '',
    assignment: {
      external_id: `${PRACTICE}${quiz.external_id}`,
      web_url: quiz.web_url,
      raw_kind: 'practice_quiz',
      name: quiz.title,
      html: quiz.html,
      due_at: quiz.due_at,
      unlock_at: quiz.unlock_at,
      lock_at: quiz.lock_at,
      points: quiz.points,
      allowed_attempts: quiz.allowed_attempts,
      locked: quiz.locked,
      lock_explanation: quiz.lock_explanation,
    },
    submission: null,
    quiz: { question_count: quiz.question_count, time_limit: quiz.time_limit },
    assessment: null,
    task: null,
  }
}

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
      const { submission, ...assignment } = found
      return {
        provider: '',
        assignment,
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
 * arrives. `quiz:<id>` names a quiz: its assignment when it has one, else (a practice quiz) what
 * the course's quizzes say of it.
 */
export function useAssignment(courseId: string, assignmentId: string) {
  const queryClient = useQueryClient()
  const quizId = assignmentId.startsWith(PRACTICE) ? assignmentId.slice(PRACTICE.length) : null
  const quiz = useQuery({
    ...lmsQuizListOptions({ path: { course_id: courseId } }),
    enabled: quizId !== null,
    select: (list) => list.items.find((q) => q.external_id === quizId) ?? null,
  })
  const own = quizId === null ? assignmentId : (quiz.data?.assignment_id ?? null)
  const whole = useQuery({
    ...assignmentOptions(courseId, own ?? ''),
    enabled: own !== null,
    placeholderData: () => (own ? listed(queryClient, courseId, own) : undefined),
  })
  const practice = quizId !== null && own === null
  if (practice) {
    return {
      data: quiz.data ? fromQuiz(quiz.data) : undefined,
      partial: false,
      practice,
      error: quiz.error ?? (quiz.data === null ? new Error('not found') : null),
      refetch: () => void quiz.refetch(),
    }
  }
  return {
    data: whole.data,
    /** Only what a list had: the feedback and its places in Semestra are still to come. */
    partial: whole.isPlaceholderData,
    practice,
    error: whole.error,
    refetch: () => void whole.refetch(),
  }
}

/** Which assignment each of the Program's assessments and to-dos is (M09 §5), read once. */
export const assignmentTargetsOptions = (programId: string) =>
  lmsAssignmentTargetsOptions({ path: { program_id: programId } })

/**
 * The platform assignment a to-do or an assessment is, when it is one: a to-do imported as such,
 * or the to-do of an imported assessment.
 */
export function useAssignmentOf(
  programId: string,
  of: { taskId?: string | null; assessmentId?: string | null },
): { courseId: string; assignmentId: string } | null {
  const found = useQuery({
    ...assignmentTargetsOptions(programId),
    enabled: programId !== '',
    select: (list) =>
      list.items.find(
        (t) =>
          (of.assessmentId != null && t.assessment_id === of.assessmentId) ||
          (of.taskId != null && t.task_id === of.taskId),
      ),
  }).data
  return found ? { courseId: found.course_id, assignmentId: found.assignment_id } : null
}
