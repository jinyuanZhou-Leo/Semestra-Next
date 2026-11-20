import { type Editor, Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'

type Options = { max: number; onRefuse: () => void }

// A document is serialized once: the limit measures it, and saving stores the same text.
const serialized = new WeakMap<Node, string>()

/** The note's Markdown for `doc` (the editor's current document unless given). */
export function noteMarkdown(editor: Editor, doc: Node = editor.state.doc): string {
  let markdown = serialized.get(doc)
  if (markdown === undefined) {
    markdown = editor.markdown?.serialize(doc.toJSON()) ?? ''
    serialized.set(doc, markdown)
  }
  return markdown
}

/**
 * Keeps the stored Markdown within `max` characters (the settings schema's limit). An edit that
 * would make a note too long is refused before it happens; edits that make it shorter always go
 * through, and so does content loaded from elsewhere (`setContent` without an update).
 */
export const NoteLimit = Extension.create<Options>({
  name: 'noteLimit',
  addOptions: () => ({ max: Number.POSITIVE_INFINITY, onRefuse: () => {} }),
  addProseMirrorPlugins() {
    const { editor, options } = this
    return [
      new Plugin({
        filterTransaction: (tr, state) => {
          if (!tr.docChanged || tr.getMeta('preventUpdate')) return true
          const next = noteMarkdown(editor, tr.doc).length
          if (next <= options.max || next <= noteMarkdown(editor, state.doc).length) return true
          options.onRefuse()
          return false
        },
      }),
    ]
  },
})
