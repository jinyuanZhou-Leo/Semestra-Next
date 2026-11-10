import {
  gradingGradebookGetOptions,
  gradingScaleGetOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { categoryName } from '@/modules/grading/display'

/**
 * The categories a category item can go into: the course's own in use (archived ones are hidden
 * from pickers), or the Program's defaults for a course the import creates. Shown in the
 * interface language; `null` until they are loaded.
 */
export function useTargetCategories(
  programId: string,
  courseRef: unknown,
): { key: string; name: string }[] | null {
  const courseId =
    typeof courseRef === 'string' && courseRef.startsWith('course:') ? courseRef.slice(7) : null
  const book = useQuery({
    ...gradingGradebookGetOptions({ path: { course_id: courseId ?? '' } }),
    enabled: courseId !== null,
  })
  const scale = useQuery({
    ...gradingScaleGetOptions({ path: { program_id: programId } }),
    enabled: courseId === null && programId !== '',
  })
  const categories = courseId
    ? book.data?.categories.filter((c) => !c.archived)
    : scale.data?.default_categories
  return categories?.map((c) => ({ key: c.key, name: categoryName(c) })) ?? null
}
