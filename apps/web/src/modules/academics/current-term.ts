import type { Term } from '@semestra/api-client'
import { academicsTermListOptions } from '@semestra/api-client/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { readUiPref, useUiPref } from '@/app/ui-pref'
import { todayDay } from '@/lib/day'
import { courseListOptions, useTerms } from './queries'

/** UI state `academics.current_term.<programId>`: a term id the user chose, null for "by date". */
export const CURRENT_TERM_KEY = 'academics.current_term'

/**
 * The term today's date points at: the one the server marks `is_current`, else (between terms)
 * the next one that starts, else the one that ended last.
 */
export function termByDate(terms: readonly Term[] | undefined, today: string): Term | undefined {
  const current = terms?.find((t) => t.is_current)
  if (current || !terms) return current
  const byStart = terms.toSorted((a, b) => a.start_date.localeCompare(b.start_date))
  return byStart.find((t) => t.start_date > today) ?? byStart.at(-1)
}

/**
 * The current term of a Program. It only decides what the sidebar shows and which term the
 * "Terms & courses" page selects first; the Today page and the week numbers keep following the
 * real date. The choice is a UI preference, not Program data.
 *
 * - `term`: the term in effect, undefined while terms load or when the Program has none.
 * - `autoTerm`: the term the date alone would give.
 * - `isManual`: whether a chosen term is in effect (false after it was deleted).
 * - `setCurrentTerm(id)`: choose a term; `setCurrentTerm(null)` goes back to "by date".
 */
export function useCurrentTerm(programId: string) {
  const termsQuery = useTerms(programId)
  const terms = termsQuery.data?.items
  const [today] = useState(todayDay)
  const [chosenId, setChosenId] = useUiPref<string | null>(CURRENT_TERM_KEY, null, {
    scope: programId,
  })
  const autoTerm = termByDate(terms, today)
  const chosen = terms?.find((t) => t.id === chosenId)
  return {
    term: chosen ?? autoTerm,
    autoTerm,
    isManual: chosen !== undefined,
    isLoading: termsQuery.isPending,
    setCurrentTerm: setChosenId,
  }
}

/**
 * Starts the courses of the current term (the sidebar lists them) once the terms and the chosen
 * term are known, from the Program's route loader instead of after the shell has rendered.
 */
export async function prefetchCurrentTermCourses(queryClient: QueryClient, programId: string) {
  const [terms, chosenId] = await Promise.all([
    queryClient.ensureQueryData(academicsTermListOptions({ path: { program_id: programId } })),
    readUiPref<string | null>(queryClient, `${CURRENT_TERM_KEY}.${programId}`),
  ])
  const term = terms.items.find((t) => t.id === chosenId) ?? termByDate(terms.items, todayDay())
  if (term) await queryClient.ensureQueryData(courseListOptions(programId, term.id))
}
