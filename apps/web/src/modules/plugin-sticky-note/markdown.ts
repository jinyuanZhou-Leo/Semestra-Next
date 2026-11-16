import type { JSONContent } from '@tiptap/core'
import { HardBreak } from '@tiptap/extension-hard-break'
import { Markdown, MarkdownManager } from '@tiptap/markdown'
import { Marked } from 'marked'

/**
 * How a note is stored (M14 §4): plain Markdown that Sem can read and write as is. GFM (tables,
 * checklists), a single line break is a line break, and no HTML: `<`, `>` and `&` are text and
 * are stored verbatim. The only tag read is `<br>`, which tables use for a break inside a cell.
 */
const BREAK = /^<br\s*\/?>/i

const marked = new Marked({
  gfm: true,
  breaks: true,
  tokenizer: {
    // No match makes marked read the source as text; `false` falls back to the built-in rule.
    html: () => undefined,
    tag: (src: string) => (BREAK.test(src) ? false : undefined),
  },
}) as unknown as typeof import('marked').marked // the manager takes the module or an instance

/** Backslashes only where a character would otherwise start formatting. */
function escapeText(text: string): string {
  return (
    text
      .replace(/[\\`*[\]~]/g, '\\$&')
      // Tiptap reads entities in text, so only an `&` that would start one is written escaped.
      .replace(/&(?=#?[a-z0-9]+;)/gi, '&amp;')
      // `_` inside a word (tax_rate) never emphasizes in GFM.
      .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '\\_')
  )
}

/**
 * Text that begins a line of a paragraph could read as a block (`- `, `1. `, `# `, `> `, `---`,
 * a setext `===` underline, a table row), so its first marker is escaped.
 */
function escapeLineStart(text: string): string {
  return text.replace(/^(\s*)([-+=>#|])/, '$1\\$2').replace(/^(\s*\d+)([.)])/, '$1\\$2')
}

function startsLine(node: JSONContent, parent?: JSONContent): boolean {
  if (parent?.type !== 'paragraph') return false
  const index = parent.content?.indexOf(node) ?? -1
  return index === 0 || parent.content?.[index - 1]?.type === 'hardBreak'
}

const isCode = (node: JSONContent, parent?: JSONContent) =>
  parent?.type === 'codeBlock' ||
  (node.marks ?? []).some((mark) => (typeof mark === 'string' ? mark : mark.type) === 'code')

/**
 * Writes text as typed. Tiptap's default stores `<`, `>` and `&` as HTML entities, and its
 * hook for that (`encodeTextForMarkdown`, used for every text node) is private, so it is
 * replaced on the instance. `markdown.test.tsx` pins the result.
 */
class NoteMarkdownManager extends MarkdownManager {
  constructor(options: ConstructorParameters<typeof MarkdownManager>[0]) {
    super(options)
    Object.defineProperty(this, 'encodeTextForMarkdown', {
      value: (text: string, node: JSONContent, parent?: JSONContent) =>
        isCode(node, parent)
          ? text
          : startsLine(node, parent)
            ? escapeLineStart(escapeText(text))
            : escapeText(text),
    })
  }
}

export const NoteMarkdown = Markdown.extend({
  onBeforeCreate(event) {
    this.parent?.(event)
    const manager = new NoteMarkdownManager({
      marked,
      indentation: this.options.indentation,
      extensions: this.editor.extensionManager.baseExtensions,
    })
    this.storage.manager = manager
    this.editor.markdown = manager
  },
}).configure({ marked })

/** A line break is a plain newline (`breaks`), not Markdown's two trailing spaces. */
export const NoteHardBreak = HardBreak.extend({ renderMarkdown: () => '\n' })
