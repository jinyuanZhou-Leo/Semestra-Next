import type { Announcement, Course } from '@semestra/api-client'
import {
  academicsCourseGetOptions,
  lmsAnnouncementListOptions,
  lmsCourseLinkGetOptions,
  lmsTermAnnouncementListOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Megaphone } from 'lucide-react'
import { CardSkeleton } from '@/app/board/CardSkeleton'
import type { CardProps } from '@/app/extensions'
import { formatDate } from '@/lib/format'
import { courseColor, courseLabel } from '@/modules/academics/color'
import { useCourses } from '@/modules/academics/queries'
import { m } from '@/paraglide/messages'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'

const LIMIT: Record<string, number> = { m: 4, l: 8 }

type Row = { item: Announcement; course: Course }

/**
 * Latest announcements from the LMS (M09 §6): the course's own, or on a term every linked
 * course's together (one read for the term). Titles open the announcement on the platform.
 */
export default function AnnouncementsCard({ scope, size }: CardProps) {
  const termId = scope.kind === 'term' ? scope.termId : undefined
  const courseId = scope.kind === 'course' ? scope.courseId : undefined
  const own = useCourseAnnouncements(courseId)
  const term = useTermAnnouncements(scope.programId, termId)
  const { rows: all, linked, loading, failed } = courseId ? own : term
  const rows = all.slice(0, LIMIT[size] ?? 8)

  if (loading && rows.length === 0) return <CardSkeleton />
  if (rows.length === 0) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Megaphone aria-hidden />
          </EmptyMedia>
          <EmptyTitle>
            {failed
              ? m.common_load_failed()
              : !linked
                ? m.lms_announcements_unlinked()
                : m.lms_announcements_empty()}
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

function useCourseAnnouncements(courseId: string | undefined) {
  const course = useQuery({
    ...academicsCourseGetOptions({ path: { course_id: courseId ?? '' } }),
    enabled: Boolean(courseId),
  }).data
  const link = useQuery({
    ...lmsCourseLinkGetOptions({ path: { course_id: courseId ?? '' } }),
    enabled: Boolean(courseId),
    staleTime: 60_000,
  })
  const linked = Boolean(link.data?.link)
  const list = useQuery({
    ...lmsAnnouncementListOptions({ path: { course_id: courseId ?? '' } }),
    enabled: Boolean(courseId) && linked,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const rows: Row[] = course ? (list.data?.items ?? []).map((item) => ({ item, course })) : []
  return {
    rows,
    linked,
    loading: link.isPending || (linked && list.isPending),
    failed: list.isError,
  }
}

function useTermAnnouncements(programId: string, termId: string | undefined) {
  const courses = useCourses(programId, termId).data?.items
  const list = useQuery({
    ...lmsTermAnnouncementListOptions({ path: { term_id: termId ?? '' } }),
    enabled: Boolean(termId),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const byId = new Map((courses ?? []).map((c) => [c.id, c]))
  const rows = (list.data?.items ?? []).flatMap((item): Row[] => {
    const course = byId.get(item.course_id)
    return course ? [{ item, course }] : []
  })
  const linked = (list.data?.linked_course_ids.length ?? 0) > 0
  return { rows, linked, loading: list.isPending || !courses, failed: list.isError }
}
