import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'

type Options = { max: number; onRefuse: () => void }

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
    const lengths = new WeakMap<Node, number>()
    const length = (doc: Node) => {
      let known = lengths.get(doc)
      if (known === undefined) {
        known = editor.markdown?.serialize(doc.toJSON()).length ?? 0
        lengths.set(doc, known)
      }
      return known
    }
    return [
      new Plugin({
        filterTransaction: (tr, state) => {
          if (!tr.docChanged || tr.getMeta('preventUpdate')) return true
          const next = length(tr.doc)
          if (next <= options.max || next <= length(state.doc)) return true
          options.onRefuse()
          return false
        },
      }),
    ]
  },
})
