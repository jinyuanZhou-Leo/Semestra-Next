/**
 * A request to show a page in a preview (a contents entry, a search hit, the page box). A new
 * object each time, so asking for the page already shown scrolls back to it.
 */
export type PageTarget = { readonly page: number }

export function pageTarget(page: number): PageTarget {
  return { page }
}
