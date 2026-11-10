import {
  gradingGradebookGetOptions,
  gradingScaleGetOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { categoryName } from '@/modules/grading/display'

/**
 * The categories a category item can go into: the course's own, or the Program's defaults for a
 * course the import creates. Shown in the interface language.
 */
export function useTargetCategories(
  programId: string,
  courseRef: unknown,
): { key: string; name: string }[] {
  const courseId =
    typeof courseRef === 'string' && courseRef.startsWith('course:') ? courseRef.slice(7) : null
  const book = useQuery({
    ...gradingGradebookGetOptions({ path: { course_id: courseId ?? '' } }),
    enabled: courseId !== null,
  })
  const scale = useQuery({
    ...gradingScaleGetOptions({ path: { program_id: programId } }),
    enabled: courseId === null,
  })
  const categories = courseId ? book.data?.categories : scale.data?.default_categories
  return (categories ?? []).map((c) => ({ key: c.key, name: categoryName(c) }))
}
