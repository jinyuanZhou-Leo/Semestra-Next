import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef } from 'react'
import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { colorTint } from '../plugin-kit/colors'
import { useCardSettings } from '../plugin-kit/useCardSettings'
import { noteExtensions } from './extensions'
import { NOTE_MAX_CHARS, type StickySettings } from './schema'
import { Toolbar } from './Toolbar'
import './note.css'

/** Sticky note (M14 §4): always editable in place, like a paper note; saved 800 ms after typing. */
export default function StickyNoteCard({ instanceId, size, settings }: CardProps<StickySettings>) {
  const { value, update, status } = useCardSettings(instanceId, settings, 800)
  // The Markdown the editor last showed or wrote; anything else came from elsewhere.
  const shown = useRef(value.content)
  const editor = useEditor({
    extensions: noteExtensions(m.sticky_placeholder()),
    content: value.content,
    contentType: 'markdown',
    editorProps: {
      attributes: { 'aria-label': m.sticky_edit(), class: 'sticky-note' },
    },
    onUpdate: ({ editor: e }) => {
      const content = e.getMarkdown()
      if (content.length > NOTE_MAX_CHARS) {
        e.commands.undo()
        return
      }
      shown.current = content
      update({ content })
    },
  })

  // The agent (or another tab) changed the note: show it, unless the user is typing.
  useEffect(() => {
    if (!editor || value.content === shown.current || editor.isFocused) return
    shown.current = value.content
    editor.commands.setContent(value.content, { contentType: 'markdown', emitUpdate: false })
  }, [editor, value.content])

  return (
    <div
      className="group/note relative flex h-full flex-col"
      style={{ backgroundColor: colorTint(value.color, 22) }}
    >
      <EditorContent
        editor={editor}
        className="min-h-0 flex-1 scroll-fade scrollbar-none overflow-y-auto px-4 py-3.5 group-focus-within/note:pb-12"
      />
      {size === 's' || !editor ? null : (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex translate-y-1 justify-center opacity-0 transition-[opacity,translate] duration-150 ease-out group-focus-within/note:pointer-events-auto group-focus-within/note:translate-y-0 group-focus-within/note:opacity-100 group-has-[[data-popup-open]]/note:pointer-events-auto group-has-[[data-popup-open]]/note:translate-y-0 group-has-[[data-popup-open]]/note:opacity-100">
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
