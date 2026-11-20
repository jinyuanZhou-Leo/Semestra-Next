import type { CourseAnnouncement, CourseLinkList } from '@semestra/api-client'
import {
  lmsAnnouncementListOptions,
  lmsCourseLinkListOptions,
  lmsTermAnnouncementListOptions,
} from '@semestra/api-client/react-query'
import { type Scope, type SearchProviderContribution, scopePath } from '@/app/extensions'
import { isSameDay, isSameYear } from 'date-fns'
import { formatDate, formatTime } from '@/lib/format'
import { m } from '@/paraglide/messages'

/** The 公告 page's id: `/c/<course>/announcements`, `/t/<term>/announcements`. */
export const ANNOUNCEMENTS_PAGE = 'announcements'

/** `?post=<course id>:<announcement id>`: the open announcement, so it can be linked to. */
export const postKey = (courseId: string, announcementId: string) => `${courseId}:${announcementId}`

/** Where an announcement opens: the 公告 page of `scope` (its course or its term) with it open. */
export function announcementPath(scope: Scope, courseId: string, announcementId: string): string {
  const post = encodeURIComponent(postKey(courseId, announcementId))
  return `${scopePath(scope, ANNOUNCEMENTS_PAGE)}?post=${post}`
}

/**
 * When an announcement was posted, as a mail list shows it: the time for today's, the day for this
 * year's, the full date for older ones. `now` comes from `useNow`, so a list left open past midnight
 * turns today's times into dates.
 */
export function postedLabel(at: string, now: number): string {
  const date = new Date(at)
  if (isSameDay(date, now)) return formatTime(date)
  return formatDate(date, { short: isSameYear(date, now) })
}

/**
 * The links the page depends on: the Program's for a course (the sidebar asks for every course of
 * the term at once, so one request answers all of them), the term's own for a term.
 */
export function announcementLinksQuery(scope: Scope) {
  if (scope.kind === 'course')
    return lmsCourseLinkListOptions({ path: { program_id: scope.programId } })
  if (scope.kind === 'term') {
    return lmsCourseLinkListOptions({
      path: { program_id: scope.programId },
      query: { term_id: scope.termId },
    })
  }
  return null
}

/** A course whose platform has announcements, or a term with at least one. */
export function hasAnnouncements(scope: Scope, data: unknown): boolean {
  const links = (data as CourseLinkList | undefined)?.items ?? []
  return links.some(
    (link) =>
      link.features.includes('announcements') &&
      (scope.kind !== 'course' || link.course_id === scope.courseId),
  )
}

const MAX_RESULTS = 8

/**
 * The command palette finds announcements of the course or term being looked at, by title or
 * text, and opens them on the 公告 page. It reads what the page and card read, from the cache
 * when they have loaded it, and only where the page exists (a linked course, a term with one).
 */
export const announcementSearch: SearchProviderContribution = {
  id: 'lms.announcements',
  title: m.lms_announcements_page_title,
  search: async (query, scope, queryClient) => {
    const links = scope ? announcementLinksQuery(scope) : null
    if (!scope || !links) return []
    let items: readonly CourseAnnouncement[]
    try {
      if (!hasAnnouncements(scope, await queryClient.ensureQueryData(links))) return []
      items =
        scope.kind === 'course'
          ? (
              await queryClient.ensureQueryData(
                lmsAnnouncementListOptions({ path: { course_id: scope.courseId } }),
              )
            ).items
          : scope.kind === 'term'
            ? (
                await queryClient.ensureQueryData(
                  lmsTermAnnouncementListOptions({ path: { term_id: scope.termId } }),
                )
              ).items
            : []
    } catch {
      return [] // not readable now: nothing to find
    }
    const needle = query.toLocaleLowerCase()
    return items
      .filter((a) => `${a.title} ${a.text}`.toLocaleLowerCase().includes(needle))
      .slice(0, MAX_RESULTS)
      .map((a) => {
        const courseId = a.course_id
        return {
          id: postKey(courseId, a.external_id),
          title: a.title,
          subtitle: [m.lms_announcements_page_title(), a.posted_at ? formatDate(a.posted_at) : null]
            .filter(Boolean)
            .join(' · '),
          to: announcementPath(scope, courseId, a.external_id),
        }
      })
  },
}
