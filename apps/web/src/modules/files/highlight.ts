/** Words of a search query worth highlighting (two characters or more). */
export function searchTerms(query: string): string[] {
  return [...new Set(query.split(/[\s,.;:!?，。；：！？、"'“”‘’()（）]+/u))].filter(
    (t) => t.length >= 2,
  )
}

/**
 * The places in `root`'s text where a search term occurs (case-insensitive), as ranges to hand to
 * `showRanges`. With `joined`, the text nodes are searched as one string (a line break, `<br>`,
 * still ends a word), so a word the layout cut into several elements is found: the PDF text layer
 * does that. Otherwise every text node is searched on its own, so the end of one paragraph or
 * cell never joins the start of the next.
 */
export function textRanges(
  root: Node,
  terms: readonly string[],
  { joined = false }: { joined?: boolean } = {},
): Range[] {
  const needles = terms.map((t) => t.toLowerCase()).filter(Boolean)
  if (needles.length === 0) return []
  const pieces: { node: Text; start: number }[] = []
  let text = ''
  // KaTeX keeps a hidden MathML copy of each formula for screen readers; a match there is invisible.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) =>
      node instanceof Element && node.classList.contains('katex-mathml')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType !== Node.TEXT_NODE) {
      if (node.nodeName === 'BR') text += '\n'
      continue
    }
    pieces.push({ node: node as Text, start: text.length })
    text += node.textContent ?? ''
    // A newline no search term contains, so a match never runs over it.
    if (!joined) text += '\n'
  }
  const lower = text.toLowerCase()
  const pieceAt = (offset: number) => pieces.findLast((piece) => piece.start <= offset)
  const ranges: Range[] = []
  for (const needle of needles) {
    for (
      let at = lower.indexOf(needle);
      at !== -1;
      at = lower.indexOf(needle, at + needle.length)
    ) {
      const first = pieceAt(at)
      const last = pieceAt(at + needle.length - 1)
      if (!first || !last) continue
      const range = new Range()
      range.setStart(first.node, at - first.start)
      range.setEnd(last.node, at + needle.length - last.start)
      ranges.push(range)
    }
  }
  return ranges
}

// What each viewer has put into a named highlight: several pages (or one text view) share a name.
const shown = new Map<string, Set<readonly Range[]>>()

/**
 * Marks `ranges` with the CSS Custom Highlight API (styled by `::highlight(<name>)` in theme.css),
 * which leaves the document's DOM as it is. Highlights under one name add up; call the returned
 * function to take these ranges away again. A no-op where the browser lacks the API.
 */
export function showRanges(name: string, ranges: readonly Range[]): () => void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return () => {}
  const mine = shown.get(name) ?? new Set<readonly Range[]>()
  shown.set(name, mine)
  const apply = () => {
    if (mine.size === 0) CSS.highlights.delete(name)
    else CSS.highlights.set(name, new Highlight(...[...mine].flat()))
  }
  mine.add(ranges)
  apply()
  return () => {
    mine.delete(ranges)
    apply()
  }
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

/** `text` split around every case-insensitive occurrence of `needle`, for rendering as text. */
export function matchParts(text: string, needle: string): SnippetPart[] {
  const wanted = needle.trim().toLowerCase()
  if (!wanted) return [{ text, marked: false }]
  const lower = text.toLowerCase()
  const parts: SnippetPart[] = []
  let from = 0
  for (let at = lower.indexOf(wanted); at >= 0; at = lower.indexOf(wanted, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), marked: false })
    parts.push({ text: text.slice(at, at + wanted.length), marked: true })
    from = at + wanted.length
  }
  if (from < text.length) parts.push({ text: text.slice(from), marked: false })
  return parts
}
