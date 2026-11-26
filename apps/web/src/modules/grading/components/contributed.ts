import type { Assessment } from '@semestra/api-client'
import { useQueries } from '@tanstack/react-query'
import { useExtensions } from '@/app/registry'
import { ASSESSMENT_COLUMNS, type AssessmentColumn, type Progress } from '../types'

/**
 * The columns other modules contribute to a course's gradebook (M03 §5.1), each read once with
 * the data that decides it: the ones the course has, and where the user is with an assessment
 * as a contributing module knows it (`AssessmentColumn.progress`; undefined when none does).
 */
export function useContributedColumns(
  programId: string,
  courseId: string,
  assessments: readonly Assessment[],
) {
  const columnExtensions = useExtensions<AssessmentColumn>(ASSESSMENT_COLUMNS)
  const decided = columnExtensions.flatMap((ext) =>
    ext.query ? [{ id: ext.id, options: ext.query({ programId, courseId }) }] : [],
  )
  const decidedData = useQueries({ queries: decided.map((d) => d.options) })
  const dataOf = new Map(decided.map((d, i) => [d.id, decidedData[i]?.data]))
  const contributed = columnExtensions.filter(
    (ext) => ext.shownFor?.(assessments, dataOf.get(ext.id)) ?? true,
  )
  const platformProgress = (a: Assessment): Progress | null | undefined => {
    for (const ext of contributed) {
      const found = ext.progress?.(a, dataOf.get(ext.id))
      if (found !== undefined) return found
    }
    return undefined
  }
  return { contributed, platformProgress }
}
