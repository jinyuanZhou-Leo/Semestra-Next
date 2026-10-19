import {
  lmsAnnouncementsListOptions,
  lmsCourseLinkGetOptions,
} from '@semestra/api-client/react-query'
import { useQueries } from '@tanstack/react-query'
import { Megaphone } from 'lucide-react'
import type { CardProps } from '@/app/extensions'
import { formatDate } from '@/lib/format'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { useCourse, useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Spinner } from '@/ui/spinner'

const LIMIT: Record<string, number> = { m: 4, l: 8 }

/**
 * Latest announcements from the LMS (M09 §6): the course's own, or on a term every linked
 * course's together. Titles open the announcement on the platform.
 */
export default function AnnouncementsCard({ scope, size }: CardProps) {
  const termId = scope.kind === 'term' ? scope.termId : undefined
  const courseId = scope.kind === 'course' ? scope.courseId : undefined
  const termCourses = useCourses(scope.programId, termId).data?.items
  const thisCourse = useCourse(courseId ?? '').data
  const courses = courseId ? (thisCourse ? [thisCourse] : []) : (termCourses ?? [])
  const links = useQueries({
    queries: courses.map((course) => ({
      ...lmsCourseLinkGetOptions({ path: { course_id: course.id } }),
      staleTime: 60_000,
    })),
  })
  const linked = courses.filter((_, i) => links[i]?.data?.link?.sync_enabled)
  const lists = useQueries({
    queries: linked.map((course) => ({
      ...lmsAnnouncementsListOptions({ path: { course_id: course.id } }),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  })
  const loading = links.some((q) => q.isPending) || lists.some((q) => q.isPending)
  const rows = lists
    .flatMap((list, i) => (list.data?.items ?? []).map((item) => ({ item, course: linked[i]! })))
    .toSorted((a, b) => Date.parse(b.item.posted_at ?? '') - Date.parse(a.item.posted_at ?? ''))
    .slice(0, LIMIT[size] ?? 8)

  if (loading && rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner aria-label={m.common_loading()} />
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Megaphone aria-hidden />
          </EmptyMedia>
          <EmptyTitle>
            {linked.length === 0 ? m.lms_announcements_unlinked() : m.lms_announcements_empty()}
          </EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map(({ item, course }) => (
        <li key={`${course.id}:${item.external_id}`}>
          <a
            href={item.web_url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg hover:bg-muted/50"
          >
            {courseId ? null : (
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: courseColor(course) }}
              />
            )}
            <span className="min-w-0 flex-1 truncate">
              {item.title}
              {courseId ? null : (
                <span className="ml-1.5 text-xs text-muted-foreground">{courseLabel(course)}</span>
              )}
            </span>
            {item.posted_at ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDate(item.posted_at)}
              </span>
            ) : null}
          </a>
        </li>
      ))}
    </ul>
  )
}
