import type { Term } from '@semestra/api-client'
import type { QueryClient } from '@tanstack/react-query'
import {
  academicsCourseGetOptions,
  academicsTermListOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import { useEffect } from 'react'
import { readUiPref, useUiPref } from '@/app/ui-pref'
import { todayDay } from '@/lib/day'
import { CURRENT_TERM_KEY, termByDate, useCurrentTerm } from './current-term'
import { courseTermId, useTerms } from './queries'

/**
 * UI state `academics.viewing_term.<programId>`: the term the sidebar shows when it is not the
 * current one (M02 §5.1), null for the current term. Opening another term's page sets it; it stays
 * until the user goes back to the current term, so other pages keep that term in the sidebar.
 */
export const VIEWING_TERM_KEY = 'academics.viewing_term'

const TERM_IN_PATH = /^\/p\/[^/]+\/t\/([^/?#]+)/
const COURSE_IN_PATH = /^\/p\/[^/]+\/c\/([^/?#]+)/

/**
 * The term of the page on screen: a term page's, or the term a course page belongs to (the one
 * its breadcrumb shows, M02 §5.5); undefined elsewhere and while the course loads.
 */
function usePageTerm(pathname: string, terms: readonly Term[] | undefined): string | undefined {
  const inPath = TERM_IN_PATH.exec(pathname)?.[1]
  const courseId = inPath ? undefined : COURSE_IN_PATH.exec(pathname)?.[1]
  const fromTerm = useLocation({
    select: (l) => (l.search as { fromTerm?: unknown }).fromTerm,
  })
  const course = useQuery({
    ...academicsCourseGetOptions({ path: { course_id: courseId ?? '' } }),
    enabled: courseId !== undefined,
  }).data
  if (inPath) return inPath
  if (!courseId || !course) return undefined
  return courseTermId(course, terms, typeof fromTerm === 'string' ? fromTerm : undefined)
}

/**
 * The term the sidebar shows: the term of the page on screen, else the one the user went to last
 * (until they go back), else the current term. `isOther` tells whether it is not the current one.
 */
export function useViewedTerm(programId: string, pathname: string) {
  const { term: current } = useCurrentTerm(programId)
  const terms = useTerms(programId).data?.items
  const [viewingId, setViewingId] = useUiPref<string | null>(VIEWING_TERM_KEY, null, {
    scope: programId,
  })
  const pageTerm = usePageTerm(pathname, terms)
  const viewed = terms?.find((t) => t.id === (pageTerm ?? viewingId))
  const term = viewed ?? current
  return {
    term,
    current,
    terms: terms ?? [],
    loaded: terms !== undefined,
    isOther: term !== undefined && current !== undefined && term.id !== current.id,
    backToCurrent: () => setViewingId(null),
  }
}

/**
 * A term or course page remembers its term as the one the sidebar shows (or forgets it for the
 * current term). A course page passes undefined until it knows its term.
 */
export function useRememberViewedTerm(programId: string, termId: string | undefined) {
  const { term: current } = useCurrentTerm(programId)
  const [viewingId, setViewingId] = useUiPref<string | null>(VIEWING_TERM_KEY, null, {
    scope: programId,
  })
  const next =
    current === undefined || termId === undefined
      ? undefined
      : termId === current.id
        ? null
        : termId
  useEffect(() => {
    if (next !== undefined && next !== viewingId) setViewingId(next)
  }, [next, viewingId, setViewingId])
}

/** The term the sidebar shows, outside React: for the start page (M11 `start_page`). */
export async function viewedTerm(
  queryClient: QueryClient,
  programId: string,
): Promise<Term | undefined> {
  const [terms, viewingId, chosenId] = await Promise.all([
    queryClient.ensureQueryData(academicsTermListOptions({ path: { program_id: programId } })),
    readUiPref<string | null>(queryClient, `${VIEWING_TERM_KEY}.${programId}`),
    readUiPref<string | null>(queryClient, `${CURRENT_TERM_KEY}.${programId}`),
  ])
  return (
    terms.items.find((t) => t.id === viewingId) ??
    terms.items.find((t) => t.id === chosenId) ??
    termByDate(terms.items, todayDay())
  )
}
