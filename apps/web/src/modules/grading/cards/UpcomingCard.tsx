import { gradingAssessmentUpcomingOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock } from 'lucide-react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
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
  // One request for the whole scope; the server picks and orders them.
  const upcoming = useQuery(
    gradingAssessmentUpcomingOptions({
      path: { program_id: scope.programId },
      query: { term_id: termId, course_id: courseId, limit: LIMIT[size] ?? 8 },
    }),
  )
  const byId = new Map(courses.map((course) => [course.id, course]))
  const rows = (upcoming.data?.items ?? []).flatMap((assessment) => {
    const course = byId.get(assessment.course_id)
    return course ? [{ assessment, course }] : []
  })
  if (upcoming.isPending || (!courseId && !termCourses) || (courseId && !thisCourse)) {
    return <CardSkeleton />
  }
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
