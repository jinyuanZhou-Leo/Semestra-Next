import {
  gradingCourseSummaryListOptions,
  gradingGradebookGetOptions,
  gradingScaleGetOptions,
  gradingScaleListPresetsOptions,
  gradingSummaryProgramOptions,
  gradingSummaryTermOptions,
} from '@semestra/api-client/react-query'
import { type QueryClient, keepPreviousData, useQuery } from '@tanstack/react-query'
import type { Scope } from '@/app/extensions'

export function useGradebook(courseId: string) {
  return useQuery({
    ...gradingGradebookGetOptions({ path: { course_id: courseId } }),
  })
}

/** Unfinished courses count as the Program's setting says (the server reads it). */
function termGradesOptions(termId: string) {
  return gradingSummaryTermOptions({ path: { term_id: termId } })
}

export function useTermGrades(termId: string) {
  return useQuery({ ...termGradesOptions(termId), placeholderData: keepPreviousData })
}

/** `PageContribution.prefetch` of the grades page: the gradebook, or the term's summary. */
export function prefetchGradesPage(scope: Scope, queryClient: QueryClient) {
  if (scope.kind === 'course') {
    void queryClient.prefetchQuery(
      gradingGradebookGetOptions({ path: { course_id: scope.courseId } }),
    )
  } else if (scope.kind === 'term') {
    void queryClient.prefetchQuery(termGradesOptions(scope.termId))
  }
}

export function useProgramGrades(programId: string) {
  return useQuery({
    ...gradingSummaryProgramOptions({ path: { program_id: programId } }),
  })
}

/** Every course's grade in a Program, for the all-courses columns. */
export function useCourseGrades(programId: string) {
  return useQuery({
    ...gradingCourseSummaryListOptions({ path: { program_id: programId } }),
  })
}

export function useGradingScale(programId: string) {
  return useQuery({
    ...gradingScaleGetOptions({ path: { program_id: programId } }),
  })
}

export function useScalePresets() {
  return useQuery({ ...gradingScaleListPresetsOptions(), staleTime: Infinity })
}

function operationId(queryKey: readonly unknown[]): string {
  // oxlint-disable-next-line no-underscore-dangle -- hey-api's query key field
  return String((queryKey[0] as { _id?: unknown } | undefined)?._id ?? '')
}

/**
 * Refetch everything the grading module shows, after a change made from this tab. A refetch
 * already running is kept rather than restarted, so quick edits in a row do not cancel each
 * other's reads.
 */
export function invalidateGrading(queryClient: QueryClient) {
  return queryClient.invalidateQueries(
    { predicate: (query) => operationId(query.queryKey).startsWith('grading') },
    { cancelRefetch: false },
  )
}
