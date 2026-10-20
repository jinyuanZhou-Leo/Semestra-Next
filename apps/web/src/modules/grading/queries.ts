import {
  gradingCourseSummaryListOptions,
  gradingGradebookGetOptions,
  gradingScaleGetOptions,
  gradingScaleListPresetsOptions,
  gradingSummaryProgramOptions,
  gradingSummaryTermOptions,
} from '@semestra/api-client/react-query'
import { type QueryClient, keepPreviousData, useQuery } from '@tanstack/react-query'

const STALE = 30_000

export function useGradebook(courseId: string) {
  return useQuery({
    ...gradingGradebookGetOptions({ path: { course_id: courseId } }),
    staleTime: STALE,
  })
}

export function useTermGrades(termId: string, includeInProgress = false) {
  return useQuery({
    ...gradingSummaryTermOptions({
      path: { term_id: termId },
      query: { include_in_progress: includeInProgress },
    }),
    staleTime: STALE,
    placeholderData: keepPreviousData,
  })
}

export function useProgramGrades(programId: string) {
  return useQuery({
    ...gradingSummaryProgramOptions({ path: { program_id: programId } }),
    staleTime: STALE,
  })
}

/** Every course's grade in a Program, for the all-courses columns. */
export function useCourseGrades(programId: string) {
  return useQuery({
    ...gradingCourseSummaryListOptions({ path: { program_id: programId } }),
    staleTime: STALE,
  })
}

export function useGradingScale(programId: string) {
  return useQuery({
    ...gradingScaleGetOptions({ path: { program_id: programId } }),
    staleTime: STALE,
  })
}

export function useScalePresets() {
  return useQuery({ ...gradingScaleListPresetsOptions(), staleTime: Infinity })
}

function operationId(queryKey: readonly unknown[]): string {
  // oxlint-disable-next-line no-underscore-dangle -- hey-api's query key field
  return String((queryKey[0] as { _id?: unknown } | undefined)?._id ?? '')
}

/** Refetch everything the grading module shows, after a change made from this tab. */
export function invalidateGrading(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => operationId(query.queryKey).startsWith('grading'),
  })
}
