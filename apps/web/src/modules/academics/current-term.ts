import { useUiPref } from '@/app/ui-pref'
import { currentTerm as termByDate, useTerms } from './queries'

/** UI state `academics.current_term.<programId>`: a term id the user chose, null for "by date". */
export const CURRENT_TERM_KEY = 'academics.current_term'

/**
 * The current term of a Program (design: UI/UX round 2, option A). It only decides what the
 * sidebar shows and which term the "Terms & courses" page selects first; the Today page and the
 * week numbers keep following the real date. The choice is a UI preference, not Program data.
 *
 * - `term`: the term in effect, undefined while terms load or when the Program has none.
 * - `autoTerm`: the term the date alone would give.
 * - `isManual`: whether a chosen term is in effect (false after it was deleted).
 * - `setCurrentTerm(id)`: choose a term; `setCurrentTerm(null)` goes back to "by date".
 */
export function useCurrentTerm(programId: string) {
  const termsQuery = useTerms(programId)
  const terms = termsQuery.data?.items
  const [chosenId, setChosenId] = useUiPref<string | null>(CURRENT_TERM_KEY, null, {
    scope: programId,
  })
  const autoTerm = termByDate(terms)
  const chosen = terms?.find((t) => t.id === chosenId)
  return {
    term: chosen ?? autoTerm,
    autoTerm,
    isManual: chosen !== undefined,
    isLoading: termsQuery.isPending,
    setCurrentTerm: setChosenId,
  }
}
