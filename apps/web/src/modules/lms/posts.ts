import type { Course, CourseAnnouncement } from '@semestra/api-client'
import {
  lmsAnnouncementListOptions,
  lmsCourseLinkGetOptions,
  lmsTermAnnouncementListOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import type { Scope } from '@/app/extensions'
import { useCourse, useCourses } from '@/modules/academics/queries'

/** An announcement with the course it was posted in. */
export type Post = { item: CourseAnnouncement; course: Course }

/**
 * The announcements of a course, or of every linked course of a term, newest first, as the sync
 * stored them (M09 §4.3): the 公告 page and the card read the same queries. The server answers
 * from its own copy, so they keep the app's defaults; the sync's events refresh them.
 */
export function useAnnouncements(scope: Scope) {
  const courseId = scope.kind === 'course' ? scope.courseId : ''
  const termId = scope.kind === 'term' ? scope.termId : ''
  const course = useCourse(courseId, { enabled: courseId !== '' }).data
  const link = useQuery({
    ...lmsCourseLinkGetOptions({ path: { course_id: courseId } }),
    enabled: courseId !== '',
    staleTime: 60_000,
  })
  const linked = Boolean(link.data?.link)
  const own = useQuery({
    ...lmsAnnouncementListOptions({ path: { course_id: courseId } }),
    enabled: courseId !== '' && linked,
  })
  const courses = useCourses(scope.programId, termId || undefined, {
    enabled: termId !== '',
  }).data?.items
  const termList = useQuery({
    ...lmsTermAnnouncementListOptions({ path: { term_id: termId } }),
    enabled: termId !== '',
  })
  if (courseId) {
    return {
      rows: course ? (own.data?.items ?? []).map((item) => ({ item, course })) : [],
      courses: course ? [course] : [],
      linked,
      checked: own.data ? own.data.checked_at !== null : true,
      loading: link.isPending || (linked && own.isPending) || !course,
      failed: own.isError,
    }
  }
  const byId = new Map((courses ?? []).map((c) => [c.id, c]))
  const rows = (termList.data?.items ?? []).flatMap((item): Post[] => {
    const c = byId.get(item.course_id)
    return c ? [{ item, course: c }] : []
  })
  const linkedCourses = (termList.data?.linked_course_ids ?? []).flatMap((id) => {
    const c = byId.get(id)
    return c ? [c] : []
  })
  return {
    rows,
    courses: linkedCourses,
    linked: linkedCourses.length > 0,
    checked: termList.data?.checked ?? true,
    loading: termList.isPending || !courses,
    failed: termList.isError,
  }
}
