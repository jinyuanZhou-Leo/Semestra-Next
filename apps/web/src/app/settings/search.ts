import { useEffect, useState } from 'react'

/** The highlight registered with `CSS.highlights`; `theme.css` styles `::highlight(settings-search)`. */
const HIGHLIGHT = 'settings-search'

/** The words of a query, lowercased; every one must appear for a section to match. */
export function searchWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

/** Whether a text holds every word (case-insensitive). */
export function matchesWords(text: string, words: readonly string[]): boolean {
  const lower = text.toLowerCase()
  return words.every((word) => lower.includes(word))
}

/** Every occurrence of the words in the text nodes under `root`, as ranges to highlight. */
function wordRanges(root: Node, words: readonly string[]): Range[] {
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.toLowerCase() ?? ''
    for (const word of words) {
      for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + word.length)) {
        const range = new Range()
        range.setStart(node, at)
        range.setEnd(node, at + word.length)
        ranges.push(range)
      }
    }
  }
  return ranges
}

/**
 * Full-text search over rendered settings sections (M11 §5.2): every section of the level is
 * rendered under the returned ref, each a `[data-settings-section]` element. A section matches
 * when its text holds every word of the query; the words are highlighted with the CSS Custom
 * Highlight API, so the sections' DOM stays React's. Sections fill in as their data loads, so the
 * match is redone whenever their text changes.
 *
 * Returns the ids of the matching sections, `undefined` until the first pass has run.
 */
export function useSectionSearch(query: string): {
  ref: (element: HTMLDivElement | null) => void
  matched: ReadonlySet<string> | undefined
} {
  // A callback ref kept in state: the effect follows the element when another level replaces it.
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [matched, setMatched] = useState<ReadonlySet<string>>()

  useEffect(() => {
    const words = searchWords(query)
    if (!root || words.length === 0) return
    let frame = 0
    const run = () => {
      frame = 0
      const ids = new Set<string>()
      const ranges: Range[] = []
      for (const section of root.querySelectorAll<HTMLElement>('[data-settings-section]')) {
        if (!matchesWords(section.textContent ?? '', words)) continue
        ids.add(section.id)
        ranges.push(...wordRanges(section, words))
      }
      if (canHighlight()) CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges))
      setMatched((last) => (last && sameIds(last, ids) ? last : ids))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run)
    }
    // Showing or hiding a section changes no text, so attributes are not watched.
    const observer = new MutationObserver(schedule)
    observer.observe(root, { subtree: true, childList: true, characterData: true })
    schedule()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      if (canHighlight()) CSS.highlights.delete(HIGHLIGHT)
    }
  }, [query, root])

  // While a new query is being matched, the last result stays on screen (no blank frame).
  return { ref: setRoot, matched }
}

const canHighlight = () => typeof CSS !== 'undefined' && 'highlights' in CSS

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id))
}
