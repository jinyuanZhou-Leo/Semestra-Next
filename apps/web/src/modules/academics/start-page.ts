import type { Preferences } from '@semestra/api-client'
import {
  academicsCourseGetOptions,
  academicsTermListOptions,
} from '@semestra/api-client/react-query'
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

/** Pages of the Program that are not module pages but have a sidebar entry. */
const PROGRAM_ENTRIES = ['assistant', 'academics']

/** `/p/<id>/<page>`, `/p/<id>/t/<term>[/<page>]` or `/p/<id>/c/<course>[/<page>]`, not settings. */
const SIDEBAR_PAGE = /^\/p\/([^/]+)\/(?:([tc])\/([^/]+)(?:\/(?!settings\/?$)([^/]+))?|([^/]+))\/?$/

/**
 * Whether the page at `pathname` is one the sidebar opens (a page of the Program, a term or a
 * course), so it can be the last page: not the term wizard, an import, a conversation or
 * settings, which are not a place to start from.
 */
export function isLastPageCandidate(
  pathname: string,
  programId: string,
  programPageIds: readonly string[],
): boolean {
  const match = SIDEBAR_PAGE.exec(pathname)
  if (!match || match[1] !== programId) return false
  const page = match[5]
  return page === undefined || programPageIds.includes(page) || PROGRAM_ENTRIES.includes(page)
}

/** Whether the term or course of a remembered page is still there (pages of the Program are). */
async function stillThere(queryClient: QueryClient, programId: string, path: string) {
  const match = SIDEBAR_PAGE.exec(path)
  if (!match || match[1] !== programId) return false
  const [, , kind, id] = match
  if (kind === 't') {
    const terms = await queryClient.fetchQuery({
      ...academicsTermListOptions({ path: { program_id: programId } }),
      staleTime: 0,
    })
    return terms.items.some((t) => t.id === id)
  }
  if (kind === 'c') {
    const course = await queryClient.fetchQuery({
      ...academicsCourseGetOptions({ path: { course_id: id! } }),
      staleTime: 0,
    })
    return course.program_id === programId
  }
  return true
}

/**
 * Where the Program's own address (`/p/<id>`, where `/` and the installed app go) opens: the
 * start page the user chose (M11 `start_page`). A term page opens in the term the sidebar shows;
 * without terms, and for a last page whose term or course is gone, Today. Phones choose in the
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
    // Fresh: a term or course deleted a moment ago sends its pages here.
    const there = last ? await stillThere(queryClient, programId, last).catch(() => false) : false
    return there ? last! : today
  }
  if (TERM_PAGES.has(startPage)) {
    const term = await viewedTerm(queryClient, programId).catch(() => undefined)
    if (!term) return today
    return termPath(programId, term.id, startPage === 'overview' ? undefined : startPage)
  }
  return `${base}/${startPage}`
}
