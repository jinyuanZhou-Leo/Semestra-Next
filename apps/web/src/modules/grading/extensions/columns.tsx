import type { CourseGrades } from '@semestra/api-client'
import { gradingCourseSummaryListOptions } from '@semestra/api-client/react-query'
import type { Course } from '@semestra/api-client'
import type { CourseColumn } from '@/modules/academics/types'
import { m } from '@/paraglide/messages'
import { GpaValue } from '../components/GpaValue'
import { percentText } from '../display'

const grades = (data: unknown) => data as CourseGrades | undefined
const gradeOf = (course: Course, data: unknown) =>
  grades(data)?.items.find((item) => item.course_id === course.id)

/** With "hide GPA" on, GPA must not leak through ordering or threshold filters either. */
const gpaHidden = (data: unknown) => grades(data)?.hide_gpa ?? false

const available = (data: unknown) => !gpaHidden(data)

const query = (programId: string) => ({
  ...gradingCourseSummaryListOptions({ path: { program_id: programId } }),
  staleTime: 30_000,
})

/** GPA filters are written for a 4.0 scale and scaled to the Program's maximum. */
function atLeast(points: number) {
  return (course: Course, data: unknown) => {
    const max = grades(data)?.max_points
    const own = gradeOf(course, data)?.points
    if (max === undefined || own == null || gpaHidden(data)) return false
    return own >= (points / 4) * max - 1e-9
  }
}

/** The grade and GPA columns of the all-courses table and the term's course card (M03 §5.4). */
export const courseColumns: CourseColumn[] = [
  {
    id: 'grading.grade',
    header: m.grading_grade,
    query,
    cell: (course, data) => {
      const grade = gradeOf(course, data)
      if (!grade) return <span className="text-muted-foreground">—</span>
      const percentage = grade.percentage ?? grade.current_percentage
      return (
        <span className="tabular-nums">
          {percentText(percentage)}
          {grade.letter ? (
            <span className="ml-1.5 text-xs text-muted-foreground">{grade.letter}</span>
          ) : null}
        </span>
      )
    },
    sortValue: (course, data) => {
      const grade = gradeOf(course, data)
      return grade ? (grade.percentage ?? grade.current_percentage) : null
    },
  },
  {
    id: 'grading.gpa',
    header: m.grading_gpa,
    query,
    showInTermCard: true,
    cell: (course, data) => (
      <GpaValue
        value={gradeOf(course, data)?.points}
        hidden={gpaHidden(data)}
        className="tabular-nums"
      />
    ),
    sortValue: (course, data) => (gpaHidden(data) ? null : (gradeOf(course, data)?.points ?? null)),
    filter: [
      {
        id: 'grading.gpa_max',
        label: m.grading_filter_gpa_max,
        available,
        test: (course, data) => {
          const max = grades(data)?.max_points
          const own = gradeOf(course, data)?.points
          return max !== undefined && own != null && !gpaHidden(data) && own >= max - 1e-9
        },
      },
      { id: 'grading.gpa_3_5', label: m.grading_filter_gpa_3_5, test: atLeast(3.5), available },
      { id: 'grading.gpa_3_0', label: m.grading_filter_gpa_3_0, test: atLeast(3), available },
    ],
  },
]
