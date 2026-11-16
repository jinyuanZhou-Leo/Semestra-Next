import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

/** The cells of a Markdown table row (`| a | b |`), or null when the line is not one. */
export function tableCells(line: string): string[] | null {
  const row = line.trim()
  if (!row.startsWith('|') || !row.endsWith('|') || row.length < 2) return null
  return row
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())
}

const DELIMITER = /^:?-+:?$/
const TABLE = /^\s*\|.*\|\s*\n\s*\|(\s*:?-+:?\s*\|)+\s*$/m

/**
 * Markdown typed or pasted into a note becomes formatted text (M14 §4), the way Notion and
 * Typora do it: Enter on a delimiter row (`| --- | --- |`) under a header row turns the two lines
 * into a table, and pasted Markdown (plain text, or any text holding a table) is parsed.
 * Lists, checklists and inline marks already convert as you type (StarterKit's input rules).
 */
export const MarkdownInput = Extension.create({
  name: 'markdownInput',

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if (!empty || $from.parent.type.name !== 'paragraph' || $from.depth < 1) return false
        const delimiter = tableCells($from.parent.textContent)
        if (!delimiter?.every((cell) => DELIMITER.test(cell))) return false
        const index = $from.index($from.depth - 1)
        const header = index > 0 ? $from.node($from.depth - 1).child(index - 1) : null
        if (header?.type.name !== 'paragraph') return false
        const titles = tableCells(header.textContent)
        if (titles?.length !== delimiter.length) return false

        const from = $from.before() - header.nodeSize
        const cell = (type: string, text: string) => ({
          type,
          content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
        })
        const headerRow = { type: 'tableRow', content: titles.map((t) => cell('tableHeader', t)) }
        const inserted = editor.commands.insertContentAt(
          { from, to: $from.after() },
          {
            type: 'table',
            content: [
              headerRow,
              { type: 'tableRow', content: titles.map(() => cell('tableCell', '')) },
            ],
          },
        )
        // Into the first cell of the new body row: table, header row, row, cell, paragraph.
        const first = editor.state.doc.nodeAt(from + 1)
        if (inserted && first) editor.commands.setTextSelection(from + 1 + first.nodeSize + 3)
        return inserted
      },
    }
  },

  addProseMirrorPlugins() {
    const { editor } = this
    return [
      new Plugin({
        props: {
          handlePaste: (_view, event) => {
            const text = event.clipboardData?.getData('text/plain')
            const html = event.clipboardData?.getData('text/html')
            // Rich text keeps its formatting; a table copied from a code editor is Markdown.
            if (!text || (html && !TABLE.test(text))) return false
            return editor.commands.insertContent(text, { contentType: 'markdown' })
          },
        },
      }),
    ]
  },
})
