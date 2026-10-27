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
import { readUiPref } from '@/app/ui-pref'

export function useGradebook(courseId: string) {
  return useQuery({
    ...gradingGradebookGetOptions({ path: { course_id: courseId } }),
  })
}

function termGradesOptions(termId: string, includeInProgress: boolean) {
  return gradingSummaryTermOptions({
    path: { term_id: termId },
    query: { include_in_progress: includeInProgress },
  })
}

export function useTermGrades(termId: string, includeInProgress = false) {
  return useQuery({
    ...termGradesOptions(termId, includeInProgress),
    placeholderData: keepPreviousData,
  })
}

/** Whether the term's grades count courses still in progress (a UI state, M03). */
export const IN_PROGRESS_PREF = 'grading.term.in_progress'

/** `PageContribution.prefetch` of the grades page: the gradebook, or the term's summary. */
export function prefetchGradesPage(scope: Scope, queryClient: QueryClient) {
  if (scope.kind === 'course') {
    void queryClient.prefetchQuery(
      gradingGradebookGetOptions({ path: { course_id: scope.courseId } }),
    )
  } else if (scope.kind === 'term') {
    const { termId } = scope
    // The summary's parameters include a UI state, which loads alongside.
    readUiPref<boolean>(queryClient, IN_PROGRESS_PREF)
      .then((includeInProgress) =>
        queryClient.prefetchQuery(termGradesOptions(termId, includeInProgress ?? false)),
      )
      // The page reports its own errors.
      .catch(() => undefined)
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
