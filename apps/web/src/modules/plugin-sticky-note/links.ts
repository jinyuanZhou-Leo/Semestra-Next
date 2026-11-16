import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

export function openLink(href: string) {
  window.open(href, '_blank', 'noopener,noreferrer')
}

/**
 * A click puts the cursor in a link so its text can be edited (as in Notion and Google Docs);
 * ⌘/Ctrl+click opens it, and so does the link button's popover.
 */
export const OpenLinkOnModClick = Extension.create({
  name: 'openLinkOnModClick',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleClick: (view, pos, event) => {
            if (!(event.metaKey || event.ctrlKey)) return false
            const link = view.state.doc
              .resolve(pos)
              .marks()
              .find((mark) => mark.type.name === 'link')
            if (!link) return false
            openLink(link.attrs.href as string)
            return true
          },
        },
      }),
    ]
  },
})
