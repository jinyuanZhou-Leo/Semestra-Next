import type { Term } from '@semestra/api-client'
import type { QueryClient } from '@tanstack/react-query'
import { academicsTermListOptions } from '@semestra/api-client/react-query'
import { useEffect } from 'react'
import { readUiPref, useUiPref } from '@/app/ui-pref'
import { todayDay } from '@/lib/day'
import { CURRENT_TERM_KEY, termByDate, useCurrentTerm } from './current-term'
import { useTerms } from './queries'

/**
 * UI state `academics.viewing_term.<programId>`: the term the sidebar shows when it is not the
 * current one (M02 §5.1), null for the current term. Opening another term's page sets it; it stays
 * until the user goes back to the current term, so other pages keep that term in the sidebar.
 */
export const VIEWING_TERM_KEY = 'academics.viewing_term'

const TERM_IN_PATH = /^\/p\/[^/]+\/t\/([^/?#]+)/

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
  const inPath = TERM_IN_PATH.exec(pathname)?.[1]
  const viewed = terms?.find((t) => t.id === (inPath ?? viewingId))
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

/** A term page remembers its term as the one the sidebar shows (or forgets it for the current term). */
export function useRememberViewedTerm(programId: string, termId: string) {
  const { term: current } = useCurrentTerm(programId)
  const [viewingId, setViewingId] = useUiPref<string | null>(VIEWING_TERM_KEY, null, {
    scope: programId,
  })
  const next = current === undefined ? undefined : termId === current.id ? null : termId
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
