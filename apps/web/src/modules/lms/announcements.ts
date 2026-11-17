import type { Announcement, CourseLinkList, TermAnnouncement } from '@semestra/api-client'
import { lmsAnnouncementList, lmsTermAnnouncementList } from '@semestra/api-client'
import { lmsCourseLinkListOptions } from '@semestra/api-client/react-query'
import { type Scope, type SearchProviderContribution, scopePath } from '@/app/extensions'
import { formatDate } from '@/lib/format'
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

/** An announcement as plain text: its row in the list, and what the search looks through. */
export function plainText(html: string | null | undefined): string {
  if (!html) return ''
  // Blocks and line breaks end with a space, or their words run together.
  const spaced = html.replace(/<(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, '$& ')
  const text = new DOMParser().parseFromString(spaced, 'text/html').body.textContent ?? ''
  return text.replace(/\s+/g, ' ').trim()
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
 * text, and opens them on the 公告 page. Reads go through the server's 5-minute cache.
 */
export const announcementSearch: SearchProviderContribution = {
  id: 'lms.announcements',
  title: m.lms_announcements_page_title,
  search: async (query, scope) => {
    if (!scope || scope.kind === 'program') return []
    let items: readonly (Announcement | TermAnnouncement)[]
    try {
      items =
        scope.kind === 'course'
          ? (
              await lmsAnnouncementList({
                path: { course_id: scope.courseId },
                throwOnError: true,
              })
            ).data.items
          : (await lmsTermAnnouncementList({ path: { term_id: scope.termId }, throwOnError: true }))
              .data.items
    } catch {
      return [] // not linked, or the platform can't be reached: nothing to find
    }
    const needle = query.toLocaleLowerCase()
    return items
      .filter((a) => `${a.title} ${plainText(a.html)}`.toLocaleLowerCase().includes(needle))
      .slice(0, MAX_RESULTS)
      .map((a) => {
        const courseId =
          'course_id' in a ? a.course_id : scope.kind === 'course' ? scope.courseId : ''
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
