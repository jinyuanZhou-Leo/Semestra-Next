import { skipToken, useQueries } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import type { PageContribution, Scope } from '@/app/extensions'
import { usePreferences } from '@/app/preferences'
import { useModules } from '@/app/registry'

const COURSE_PAGE = /^\/p\/[^/]+\/c\/([^/]+)\/([^/?#]+)/
const OVERVIEW = 'overview'

/** The course and tab of a course page's URL; overview and settings have no tab to keep. */
export function openCourseTab(pathname: string): { courseId: string; pageId: string } | undefined {
  const match = COURSE_PAGE.exec(pathname)
  if (!match || match[2] === OVERVIEW || match[2] === 'settings') return undefined
  return { courseId: match[1]!, pageId: match[2]! }
}

/** The course page `pageId` of the installed modules. */
export function coursePage(pages: readonly PageContribution[], pageId: string) {
  return pages.find((page) => page.id === pageId && page.scopes.includes('course'))
}

/**
 * The tab a link to another course opens from a course page: the open tab while the
 * "keep the course tab" preference is on and that course has it, otherwise its overview
 * (`undefined`). Pages that need data to tell (`availabilityQuery`) load it for `courseIds`.
 */
export function useCourseLinkTab(
  programId: string,
  courseIds: readonly string[],
): (courseId: string) => string | undefined {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const keep = usePreferences().data?.keep_course_tab ?? true
  const modules = useModules()
  const open = keep ? openCourseTab(pathname) : undefined
  const page = open
    ? coursePage(
        modules.flatMap((module) => module.pages ?? []),
        open.pageId,
      )
    : undefined
  const scopes: Scope[] = courseIds.map((courseId) => ({ kind: 'course', programId, courseId }))
  const queries = scopes.map((scope) => (page && page.availabilityQuery?.(scope)) ?? null)
  const results = useQueries({
    queries: queries.map(
      (query, i) =>
        query ?? { queryKey: ['host.page', 'course', courseIds[i]], queryFn: skipToken },
    ),
  })
  return (courseId) => {
    if (!open || !page || courseId === open.courseId) return undefined
    const i = courseIds.indexOf(courseId)
    const scope: Scope = { kind: 'course', programId, courseId }
    if (queries[i] && !results[i]?.isSuccess) return undefined
    return (page.isAvailable?.(scope, queries[i] ? results[i]?.data : undefined) ?? true)
      ? open.pageId
      : undefined
  }
}
