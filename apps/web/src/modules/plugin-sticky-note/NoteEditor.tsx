import { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { toast } from 'sonner'
import { setNoteEditing } from './editing'
import { noteExtensions } from './extensions'
import { noteMarkdown } from './limit'
import { Toolbar } from './Toolbar'

/** Where a double-click (or a click on an empty note) asked the cursor to go. */
export type StartAt = { x: number; y: number }

const extensions = () =>
  noteExtensions({
    placeholder: m.sticky_placeholder(),
    // One toast however many keys are refused.
    onTooLong: () => toast.error(m.sticky_too_long(), { id: 'sticky-too-long' }),
  })

/**
 * The note's editor (M14 §4), loaded on demand: until a note is first edited, `NoteView` draws it.
 * It draws the same elements, so swapping one for the other moves nothing. While read-only, links
 * open and checklist items tick with one click; the header's edit button, a double-click (cursor
 * where it was) or a click on an empty note makes it editable with its toolbar.
 */
export default function NoteEditor({
  instanceId,
  size,
  content,
  remote,
  editing,
  startAt,
  update,
  hasUnsaved,
}: {
  instanceId: string
  size: string
  /** The note as shown, local edits included. */
  content: string
  /** The note as last saved (by this card, the agent or another tab). */
  remote: string
  editing: boolean
  startAt: StartAt | null
  update: (patch: { content: string }) => void
  hasUnsaved: () => boolean
}) {
  // The Markdown the editor last showed or wrote; anything else came from elsewhere.
  const shown = useRef(content)
  const started = useRef<StartAt | null>(null)
  const editor = useEditor({
    editable: false,
    // Its stylesheet is part of `note.css`, which the read-only view uses too.
    injectCSS: false,
    extensions: extensions(),
    content,
    contentType: 'markdown',
    editorProps: {
      attributes: { 'aria-label': m.sticky_card_title(), class: 'sticky-note' },
      handleKeyDown: (view, event) => {
        if (event.key !== 'Escape') return false
        setNoteEditing(instanceId, false)
        // Back to the button that starts editing again, not to the page.
        view.dom.closest('[data-card]')?.querySelector<HTMLElement>('[data-sticky-edit]')?.focus()
        return true
      },
    },
    onUpdate: ({ editor: e }) => {
      const markdown = noteMarkdown(e)
      shown.current = markdown
      update({ content: markdown })
    },
  })

  // The agent (or another tab) changed the note: show it, keeping the cursor where it was if
  // the note is being edited. Not while local edits are unsaved: saving them replaces the note
  // anyway, and the server echoing an earlier save would undo the newest keystrokes. The change
  // is not the user's, so it stays out of their undo history (undo would revert it and save).
  useEffect(() => {
    if (!editor || remote === shown.current || hasUnsaved()) return
    shown.current = remote
    const { from, to } = editor.state.selection
    const keepCursor = editor.isFocused
    editor
      .chain()
      .setMeta('addToHistory', false)
      .setContent(remote, { contentType: 'markdown', emitUpdate: false })
      .command(({ tr, commands }) => {
        if (!keepCursor) return true
        const end = tr.doc.content.size
        return commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) })
      })
      .run()
  }, [editor, remote, hasUnsaved])

  // The editor follows the shared flag, which the header's button sets too. A double-click
  // puts the cursor where it was, the same spot in either view since both draw the same text.
  useEffect(() => {
    if (!editor) return
    const at = editing && startAt !== started.current ? startAt : null
    started.current = startAt
    if (editor.isEditable === editing && !at) return
    editor.setEditable(editing, false)
    if (!editing) {
      editor.commands.blur()
      return
    }
    const pos = at ? editor.view.posAtCoords({ left: at.x, top: at.y })?.pos : undefined
    if (pos !== undefined || !editor.isFocused) editor.commands.focus(pos ?? 'end')
  }, [editor, editing, startAt])

  return (
    <>
      <EditorContent
        editor={editor}
        className={cn(
          'min-h-0 flex-1 scroll-fade scrollbar-none overflow-y-auto px-4 py-3.5',
          editing && size !== 's' && 'pb-12',
        )}
      />
      {size === 's' || !editor ? null : (
        <div
          className={cn(
            'absolute inset-x-0 bottom-2 flex justify-center transition-[opacity,translate] duration-150 ease-out',
            editing ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0',
          )}
          inert={!editing || undefined}
        >
          <Toolbar editor={editor} />
        </div>
      )}
    </>
  )
}

/**
 * Ticks the `index`th checklist item (in reading order) of a read-only note: read and written by
 * the editor's rules, as a tick inside the editor would be, without showing an editor. `text` is
 * the item as the read-only view showed it; if the editor reads a different item there, nothing
 * is changed and it throws, so a misread note is never written with the wrong item ticked.
 */
export function toggleTask(
  markdown: string,
  index: number,
  checked: boolean,
  text: string,
): string {
  const editor = new Editor({
    element: null,
    injectCSS: false,
    extensions: extensions(),
    content: markdown,
    contentType: 'markdown',
  })
  let seen = 0
  let at = -1
  let found = ''
  editor.state.doc.descendants((node, pos) => {
    if (at >= 0) return false
    if (node.type.name === 'taskItem' && seen++ === index) {
      at = pos
      found = node.firstChild?.textContent ?? ''
    }
    return true
  })
  const doc =
    at >= 0 && found === text
      ? editor.state.apply(editor.state.tr.setNodeAttribute(at, 'checked', checked)).doc
      : null
  const result = doc ? noteMarkdown(editor, doc) : null
  editor.destroy()
  if (result === null) throw new Error(`Checklist item ${index} is not "${text}"`)
  return result
}
