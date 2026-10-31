import type { Preferences } from '@semestra/api-client'
import type { QueryClient } from '@tanstack/react-query'
import { readUiPref } from '@/app/ui-pref'
import { programPath, termPath } from './paths'
import { viewedTerm } from './viewing-term'

export type StartPage = Preferences['start_page']

/**
 * UI state `academics.last_page.<programId>`: the last page open in the Program on a computer,
 * kept only while the start page is "last page" (M11 `start_page`).
 */
export const LAST_PAGE_KEY = 'academics.last_page'

const TERM_PAGES: ReadonlySet<StartPage> = new Set(['overview', 'calendar', 'grades', 'files'])

/**
 * Where the Program's own address (`/p/<id>`, where `/` and the installed app go) opens: the
 * start page the user chose (M11 `start_page`). A term page opens in the term the sidebar shows;
 * without terms, and for a last page that is not there any more, Today. Phones choose in the
 * phone shell (M17), which has only some of these pages.
 */
export async function startPagePath(
  queryClient: QueryClient,
  programId: string,
  startPage: StartPage,
): Promise<string> {
  const base = programPath(programId)
  const today = `${base}/today`
  if (startPage === 'last') {
    const last = await readUiPref<string>(queryClient, `${LAST_PAGE_KEY}.${programId}`).catch(
      () => undefined,
    )
    return last?.startsWith(`${base}/`) && last.length > base.length + 1 ? last : today
  }
  if (TERM_PAGES.has(startPage)) {
    const term = await viewedTerm(queryClient, programId).catch(() => undefined)
    if (!term) return today
    return termPath(programId, term.id, startPage === 'overview' ? undefined : startPage)
  }
  return `${base}/${startPage}`
}
