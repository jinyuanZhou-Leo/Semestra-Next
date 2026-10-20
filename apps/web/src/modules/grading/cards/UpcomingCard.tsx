import type { Assessment } from '@semestra/api-client'
import { gradingGradebookGetOptions } from '@semestra/api-client/react-query'
import { useQueries } from '@tanstack/react-query'
import { CalendarClock } from 'lucide-react'
import type { CardProps } from '@/app/extensions'
import { HistoryLink } from '@/components/HistoryLink'
import { cn } from '@/lib/utils'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { coursePath } from '@/modules/academics/paths'
import { useCourse, useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { dueText } from '../display'

const LIMIT: Record<string, number> = { m: 4, l: 8 }

/** Ungraded assessments with a deadline, soonest first, overdue ones highlighted (M03 §5.3). */
export default function UpcomingCard({ scope, size }: CardProps) {
  const termId = scope.kind === 'term' ? scope.termId : undefined
  const courseId = scope.kind === 'course' ? scope.courseId : undefined
  const termCourses = useCourses(scope.programId, termId).data?.items
  const thisCourse = useCourse(courseId ?? '').data
  const courses = courseId ? (thisCourse ? [thisCourse] : []) : (termCourses ?? [])
  const lists = useQueries({
    queries: courses.map((course) => ({
      // The gradebook carries every assessment (the list endpoint pages) and shares its cache
      // with the other grading cards.
      ...gradingGradebookGetOptions({ path: { course_id: course.id } }),
    })),
  })
  const rows = lists
    .flatMap((list, i) =>
      (list.data?.assessments ?? []).map((assessment) => ({ assessment, course: courses[i]! })),
    )
    .filter(
      ({ assessment: a }: { assessment: Assessment }) =>
        a.status !== 'graded' && !a.dropped && a.due_at !== null,
    )
    .toSorted(
      (a, b) => Date.parse(a.assessment.due_at ?? '') - Date.parse(b.assessment.due_at ?? ''),
    )
    .slice(0, LIMIT[size] ?? 8)
  if (rows.length === 0) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarClock aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.grading_upcoming_empty()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map(({ assessment: a, course }) => (
        <li key={a.id}>
          <HistoryLink
            href={coursePath(scope.programId, course.id, 'grades', termId)}
            className="flex items-center gap-2 rounded-lg hover:bg-muted/50"
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: courseColor(course) }}
            />
            <span className="min-w-0 flex-1 truncate">
              {a.title}
              {courseId ? null : (
                <span className="ml-1.5 text-xs text-muted-foreground">{courseLabel(course)}</span>
              )}
            </span>
            <span
              className={cn(
                'shrink-0 text-xs text-muted-foreground',
                a.status === 'overdue' && 'text-destructive',
              )}
            >
              {dueText(a)}
            </span>
          </HistoryLink>
        </li>
      ))}
    </ul>
  )
}
