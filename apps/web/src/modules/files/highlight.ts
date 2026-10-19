const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(text: string) {
  return text.replaceAll(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch)
}

function escapeRegExp(text: string) {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

/** Words of a search query worth highlighting (two characters or more). */
export function searchTerms(query: string): string[] {
  return [...new Set(query.split(/[\s,.;:!?，。；：！？、"'“”‘’()（）]+/u))].filter(
    (t) => t.length >= 2,
  )
}

/**
 * `text` as HTML with every case-insensitive match of `terms` in `<mark>`, for the PDF text
 * layer. The text comes from the file, so everything else is escaped.
 */
export function highlightHtml(text: string, terms: readonly string[]): string {
  const usable = terms.filter(Boolean)
  if (usable.length === 0) return escapeHtml(text)
  const pattern = new RegExp(
    usable
      .toSorted((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|'),
    'gi',
  )
  let out = ''
  let last = 0
  for (const match of text.matchAll(pattern)) {
    out += `${escapeHtml(text.slice(last, match.index))}<mark>${escapeHtml(match[0])}</mark>`
    last = match.index + match[0].length
  }
  return out + escapeHtml(text.slice(last))
}

export type SnippetPart = { text: string; marked: boolean }

/** A search snippet (plain text with `<mark>` around matches) split for rendering as text. */
export function snippetParts(snippet: string): SnippetPart[] {
  return snippet
    .split(/(<mark>.*?<\/mark>)/s)
    .filter(Boolean)
    .map((part) =>
      part.startsWith('<mark>') && part.endsWith('</mark>')
        ? { text: part.slice(6, -7), marked: true }
        : { text: part, marked: false },
    )
}
