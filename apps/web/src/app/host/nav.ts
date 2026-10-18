import type { Nav } from '@semestra/api-client'
import { layoutsNavUpdate } from '@semestra/api-client'
import { layoutsNavGetOptions } from '@semestra/api-client/react-query'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { toastError } from '@/lib/errors'
import type { PageContribution, Scope, ScopeKind } from '../extensions'
import { usePages } from '../registry'

/** The board page every scope opens on; it cannot be hidden. */
export const OVERVIEW_PAGE = 'overview'

/**
 * Pages in the user's tab order (M10 §5.1): ids in `nav.order` first, in that order, then the
 * rest in registry order (pages added since the order was saved come last).
 */
export function orderPages<P extends Pick<PageContribution, 'id'>>(
  pages: readonly P[],
  nav: Pick<Nav, 'order'> | undefined,
): P[] {
  const rank = new Map((nav?.order ?? []).map((id, index) => [id, index]))
  return pages
    .map((page, index) => ({ page, index }))
    .sort((a, b) => {
      const ra = rank.get(a.page.id) ?? rank.size + a.index
      const rb = rank.get(b.page.id) ?? rank.size + b.index
      return ra - rb
    })
    .map(({ page }) => page)
}

export function navOptions(kind: ScopeKind) {
  return layoutsNavGetOptions({ path: { scope_type: kind } })
}

/** The pages of a scope in tab order: `pages` without the hidden ones, `all` with them. */
export function useScopePages(scope: Scope) {
  const pages = usePages(scope)
  const { data: nav } = useQuery(navOptions(scope.kind))
  const all = orderPages(pages, nav)
  const hidden = new Set(nav?.hidden ?? [])
  return {
    all,
    pages: all.filter((p) => p.id === OVERVIEW_PAGE || !hidden.has(p.id)),
    hidden,
  }
}

/**
 * Saves the order and hidden pages of a scope type at once (the tabs follow immediately) and
 * restores them if the save fails. Ids of pages not shown now (plugins not installed) are kept.
 */
export function useSaveNav(kind: ScopeKind) {
  const queryClient = useQueryClient()
  return useCallback(
    async (next: { order: string[]; hidden: string[] }) => {
      const { queryKey } = navOptions(kind)
      let previous: Nav
      try {
        // A change made before the stored nav has loaded must still keep its other ids.
        previous = await queryClient.ensureQueryData(navOptions(kind))
      } catch (err) {
        toastError(err)
        return
      }
      const keep = (ids: readonly string[] | undefined, shown: readonly string[]) =>
        (ids ?? []).filter((id) => !shown.includes(id))
      const merged = {
        order: [...next.order, ...keep(previous.order, next.order)],
        hidden: [...next.hidden, ...keep(previous.hidden, [...next.order, ...next.hidden])],
      }
      queryClient.setQueryData<Nav>(queryKey, { scope_type: kind, ...merged })
      try {
        const { data } = await layoutsNavUpdate({
          path: { scope_type: kind },
          body: merged,
          throwOnError: true,
        })
        queryClient.setQueryData(queryKey, data)
      } catch (err) {
        queryClient.setQueryData(queryKey, previous)
        toastError(err)
      }
    },
    [kind, queryClient],
  )
}
