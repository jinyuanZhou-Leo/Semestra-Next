import type { Nav } from '@semestra/api-client'
import { useQuery } from '@tanstack/react-query'
import { type PageContribution, type Scope, scopePath } from '@/app/extensions'
import { navOptions, OVERVIEW_PAGE, orderPages, useSaveNav } from '@/app/host/nav'
import { usePages } from '@/app/registry'

/** The Program's overview board, shown at the bottom of the sidebar as "Academic summary". */
export const SUMMARY_PAGE = 'summary'

export type SidebarPage = {
  id: string
  page: PageContribution
  /** Where the page lives: the Program, or the term the sidebar shows. */
  scope: Scope
  href: string
}

/**
 * The pages in the sidebar's main group (M02 §5.1): the Program's pages (Today, Tasks, plugins)
 * and the pages of the term the sidebar shows (overview, calendar, grades, files), as one list
 * in one order. A page both levels have (Tasks) is the Program's, which covers every term. The
 * order and the hidden pages are saved with the Program's nav; pages hidden before as term tabs
 * stay hidden.
 */
export function useSidebarPages(programId: string, termId: string | undefined) {
  const programScope: Scope = { kind: 'program', programId }
  const termScope: Scope = { kind: 'term', programId, termId: termId ?? '' }
  const programPages = usePages(programScope).filter((p) => p.id !== SUMMARY_PAGE)
  const termPages = usePages(termScope)
  const { data: programNav } = useQuery(navOptions('program'))
  const { data: termNav } = useQuery(navOptions('term'))
  const saveProgram = useSaveNav('program')
  const saveTerm = useSaveNav('term')

  const programIds = new Set(programPages.map((p) => p.id))
  const termOnly = termPages.filter((page) => !programIds.has(page.id)).map((page) => page.id)
  const entries: SidebarPage[] = [
    ...programPages.map((page) => ({
      id: page.id,
      page,
      scope: programScope,
      href: scopePath(programScope, page.id),
    })),
    ...(termId ? termPages : [])
      .filter((page) => !programIds.has(page.id))
      .map((page) => ({
        id: page.id,
        page,
        scope: termScope,
        href: scopePath(termScope, page.id === OVERVIEW_PAGE ? undefined : page.id),
      })),
  ].toSorted((a, b) => a.page.order - b.page.order)
  const all = isLegacyOrder(programNav, termOnly)
    ? orderProgramPagesOnly(entries, programNav)
    : orderPages(entries, programNav)
  const hidden = new Set([...(programNav?.hidden ?? []), ...(termNav?.hidden ?? [])])

  const save = (next: Pick<Nav, 'order' | 'hidden'>) => {
    void saveProgram(next)
    // A page shown again is taken off the term tabs' old hidden list too.
    const termHidden = termNav?.hidden ?? []
    if (termHidden.some((id) => !next.hidden.includes(id) && next.order.includes(id))) {
      void saveTerm({
        order: termNav?.order ?? [],
        hidden: termHidden.filter((id) => next.hidden.includes(id) || !next.order.includes(id)),
      })
    }
  }
  return {
    all,
    shown: all.filter((entry) => entry.id === OVERVIEW_PAGE || !hidden.has(entry.id)),
    hidden,
    save,
  }
}

/**
 * A Program nav saved before the sidebar held term pages lists only the Program's own pages, with
 * `overview` meaning the Program's board (now "summary"). Its order is kept among the Program's
 * pages, each term page keeps its own place, and that old `overview` is ignored.
 */
function isLegacyOrder(nav: Pick<Nav, 'order'> | undefined, termOnly: readonly string[]) {
  const order = nav?.order ?? []
  return order.length > 0 && !order.some((id) => termOnly.includes(id))
}

function orderProgramPagesOnly(entries: SidebarPage[], nav: Pick<Nav, 'order'> | undefined) {
  const order = (nav?.order ?? []).filter((id) => id !== OVERVIEW_PAGE)
  const ordered = orderPages(
    entries.filter((entry) => entry.scope.kind === 'program'),
    { order },
  )
  let next = 0
  return entries.map((entry) => (entry.scope.kind === 'program' ? ordered[next++]! : entry))
}

const TERM_PAGE = /^\/p\/[^/]+\/t\/[^/]+(?:\/([^/?#]+))?\/?$/

/** Whether `entry` is the page on screen; a term page matches in any term, Tasks also a term's. */
export function isSidebarPageActive(entry: SidebarPage, pathname: string): boolean {
  if (pathname === entry.href) return true
  const termPage = TERM_PAGE.exec(pathname)
  if (!termPage) return false
  const id = termPage[1] ?? OVERVIEW_PAGE
  return id === entry.id
}
