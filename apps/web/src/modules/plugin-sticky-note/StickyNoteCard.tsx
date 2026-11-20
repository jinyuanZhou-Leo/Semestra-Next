import { EditorContent, useEditor } from '@tiptap/react'
import { type MouseEvent, useEffect, useRef } from 'react'
import type { CardProps } from '@/app/extensions'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { toast } from 'sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { colorTint } from '../plugin-kit/colors'
import { useCardSettings } from '../plugin-kit/useCardSettings'
import { setNoteEditing, useNoteEditing } from './editing'
import { noteExtensions } from './extensions'
import type { StickySettings } from './schema'
import { Toolbar } from './Toolbar'
import './note.css'

/** Inside a popup (the toolbar's link popover or table menu), which is portaled out of the card. */
const inPopup = (target: EventTarget | null) =>
  target instanceof Element && target.closest('[data-slot$="-content"]') !== null

/**
 * Sticky note (M14 §4). It reads like a note: links open and checklist items tick with one click.
 * The header's edit button (or a double-click on the text, or a click on an empty note) makes it
 * editable with its toolbar; clicking outside the card, Escape or the "done" button ends that.
 * Saved 800 ms after a change.
 */
export default function StickyNoteCard({ instanceId, size, settings }: CardProps<StickySettings>) {
  const { value, update, hasUnsaved, status } = useCardSettings(instanceId, settings, 800)
  const editing = useNoteEditing(instanceId)
  const root = useRef<HTMLDivElement>(null)
  // The Markdown the editor last showed or wrote; anything else came from elsewhere.
  const shown = useRef(value.content)
  const editor = useEditor({
    editable: false,
    extensions: noteExtensions({
      placeholder: m.sticky_placeholder(),
      // One toast however many keys are refused.
      onTooLong: () => toast.error(m.sticky_too_long(), { id: 'sticky-too-long' }),
    }),
    content: value.content,
    contentType: 'markdown',
    editorProps: {
      attributes: { 'aria-label': m.sticky_card_title(), class: 'sticky-note' },
      handleKeyDown: (_, event) => {
        if (event.key !== 'Escape') return false
        setNoteEditing(instanceId, false)
        // Back to the button that starts editing again, not to the page.
        root.current
          ?.closest('[data-card]')
          ?.querySelector<HTMLElement>('[data-sticky-edit]')
          ?.focus()
        return true
      },
    },
    onUpdate: ({ editor: e }) => {
      const content = e.getMarkdown()
      shown.current = content
      update({ content })
    },
  })

  // The agent (or another tab) changed the note: show it, keeping the cursor where it was if
  // the note is being edited. Not while local edits are unsaved: saving them replaces the note
  // anyway, and the server echoing an earlier save would undo the newest keystrokes. The change
  // is not the user's, so it stays out of their undo history (undo would revert it and save).
  useEffect(() => {
    if (!editor || settings.content === shown.current || hasUnsaved()) return
    shown.current = settings.content
    const { from, to } = editor.state.selection
    const keepCursor = editor.isFocused
    editor
      .chain()
      .setMeta('addToHistory', false)
      .setContent(settings.content, { contentType: 'markdown', emitUpdate: false })
      .command(({ tr, commands }) => {
        if (!keepCursor) return true
        const end = tr.doc.content.size
        return commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) })
      })
      .run()
  }, [editor, settings.content, hasUnsaved])

  // The editor follows the shared flag, which the header's button sets too.
  useEffect(() => {
    if (!editor || editor.isEditable === editing) return
    editor.setEditable(editing, false)
    if (!editing) editor.commands.blur()
    else if (!editor.isFocused) editor.commands.focus('end')
  }, [editor, editing])

  // Leaving the card ends editing: a click elsewhere, or the focus moving out with the keyboard.
  // The header's buttons are in the card, and the toolbar's popups count as part of the note.
  useEffect(() => {
    if (!editing) return
    const outside = (target: EventTarget | null) => {
      const card = root.current?.closest('[data-card]') ?? root.current
      return target instanceof Node && !card?.contains(target) && !inPopup(target)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (outside(event.target)) setNoteEditing(instanceId, false)
    }
    const onFocusIn = (event: FocusEvent) => {
      if (outside(event.target)) setNoteEditing(instanceId, false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [editing, instanceId])

  useEffect(() => () => setNoteEditing(instanceId, false), [instanceId])

  /** Starts editing with the cursor where the note was clicked. */
  const editAt = (event: MouseEvent) => {
    if (editing || !editor) return
    const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
    editor.setEditable(true, false)
    editor
      .chain()
      .focus(at?.pos ?? 'end')
      .run()
    setNoteEditing(instanceId, true)
  }

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- pointer shortcuts; the header's edit button is the keyboard way in
    <div
      ref={root}
      className="relative flex h-full flex-col"
      style={{ backgroundColor: colorTint(value.color, 22) }}
      onDoubleClick={editAt}
      onClick={(event) => {
        if (editor?.isEmpty) editAt(event)
      }}
    >
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
      {status === 'error' ? (
        <Tooltip>
          <TooltipTrigger render={<output className="absolute top-2 right-2" />}>
            <span className="sr-only">{m.sticky_save_failed()}</span>
            <span aria-hidden className="block size-1.5 rounded-full bg-destructive" />
          </TooltipTrigger>
          <TooltipContent>{m.sticky_save_failed()}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
