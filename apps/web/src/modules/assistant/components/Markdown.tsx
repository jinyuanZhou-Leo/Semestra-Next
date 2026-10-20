import { lazy } from 'react'
import type { Citation } from '../stream'

const CITE = /\[\[cite:([^\]\s]+)\]\]/g
export const CITE_HREF = '#cite:'

/** `[[cite:<id>]]` markers become numbered links the renderer turns into citation badges. */
export function linkCitations(text: string, citations: ReadonlyMap<string, Citation>): string {
  const numbers = new Map<string, number>()
  return text.replace(CITE, (_, id: string) => {
    if (!citations.has(id)) return ''
    const n = numbers.get(id) ?? numbers.size + 1
    numbers.set(id, n)
    return `[${n}](${CITE_HREF}${encodeURIComponent(id)})`
  })
}

export type MarkdownProps = {
  text: string
  citations: ReadonlyMap<string, Citation>
  /** The answer is still being written. */
  streaming?: boolean
  className?: string
}

// The renderer (Streamdown with code, math and diagram plugins) is most of the Sem page's
// weight, so it is its own chunk, fetched as soon as this module loads, while the
// conversation itself is still being fetched.
const load = () => import('./Response')
const Response = lazy(load)
void load()

/**
 * An answer (M12 §6.1), rendered by AI Elements' `MessageResponse` (Streamdown): GFM, code,
 * math and diagrams, with citation badges and in-app links. Streamdown splits the text into
 * blocks and redraws only the one still growing, so a long answer streams without re-parsing.
 * While the renderer loads it suspends: the conversation keeps its loading state for all
 * answers at once, instead of showing raw text that then reflows.
 */
export function Markdown(props: MarkdownProps) {
  return <Response {...props} />
}
