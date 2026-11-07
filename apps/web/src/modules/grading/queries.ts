import {
  gradingCourseSummaryListOptions,
  gradingGradebookGetOptions,
  gradingScaleGetOptions,
  gradingScaleListPresetsOptions,
  gradingSummaryProgramOptions,
  gradingSummaryTermOptions,
  settingsValueGetOptions,
} from '@semestra/api-client/react-query'
import { type QueryClient, keepPreviousData, useQuery } from '@tanstack/react-query'
import type { Scope } from '@/app/extensions'

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

export function useTermGrades(termId: string, includeInProgress = false, enabled = true) {
  return useQuery({
    ...termGradesOptions(termId, includeInProgress),
    enabled,
    placeholderData: keepPreviousData,
  })
}

/** The `grading` namespace (M11), resolved for a Program. */
export type GradingSettings = { count_in_progress: boolean }

const gradingSettingsOptions = (programId: string) =>
  settingsValueGetOptions({
    path: { namespace: 'grading' },
    query: { scope_type: 'program', scope_id: programId },
  })

export function useGradingSettings(programId: string) {
  return useQuery({
    ...gradingSettingsOptions(programId),
    select: (data): GradingSettings => ({
      count_in_progress: false,
      ...(data.values as Partial<GradingSettings>),
    }),
  })
}

/** `PageContribution.prefetch` of the grades page: the gradebook, or the term's summary. */
export function prefetchGradesPage(scope: Scope, queryClient: QueryClient) {
  if (scope.kind === 'course') {
    void queryClient.prefetchQuery(
      gradingGradebookGetOptions({ path: { course_id: scope.courseId } }),
    )
  } else if (scope.kind === 'term') {
    const { termId } = scope
    // The summary's parameters include a setting, which loads alongside.
    queryClient
      .fetchQuery(gradingSettingsOptions(scope.programId))
      .then((data) =>
        queryClient.prefetchQuery(
          termGradesOptions(termId, data.values?.count_in_progress === true),
        ),
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
