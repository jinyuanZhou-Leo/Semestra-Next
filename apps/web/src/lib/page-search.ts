/**
 * The search params of a course or term page, which belong to the page itself (the Canvas tab's
 * location, the files page's folder, an open announcement). The router reads values as JSON, so
 * `?organize=true` or `?ref=12345` arrive as a boolean or a number: they are kept as text.
 */
export function pageSearch(search: Record<string, unknown>): Record<string, string> {
  const kept: Record<string, string> = {}
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === 'string') kept[key] = value
    else if (typeof value === 'number' || typeof value === 'boolean') kept[key] = String(value)
  }
  return kept
}
