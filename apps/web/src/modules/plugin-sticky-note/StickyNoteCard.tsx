import { type MouseEvent, useEffect, useRef, useState } from 'react'
import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { toast } from 'sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { colorTint } from '../plugin-kit/colors'
import { useCardSettings } from '../plugin-kit/useCardSettings'
import { forgetNote, setNoteEditing, useNoteEditing, useNoteOpened } from './editing'
import { loadEditor, preloadEditor, useEditorModule } from './editor-loader'
import type { StartAt } from './NoteEditor'
import { NoteView } from './NoteView'
import type { StickySettings } from './schema'
import './note.css'

/** Inside a popup (the toolbar's link popover or table menu), which is portaled out of the card. */
const inPopup = (target: EventTarget | null) =>
  target instanceof Element && target.closest('[data-slot$="-content"]') !== null

const isEmpty = (content: string) => /^(?:\s|&nbsp;| )*$/.test(content)

/** A checklist item ticked while the editor was still loading, shown until the note is saved. */
type Tick = { content: string; index: number; checked: boolean }

/**
 * Sticky note (M14 §4). It reads like a note: links open and checklist items tick with one click.
 * The header's edit button (or a double-click on the text, or a click on an empty note) makes it
 * editable with its toolbar; clicking outside the card, Escape or the "done" button ends that.
 * Until it is first edited the note is drawn by `NoteView`, without loading the editor.
 * Saved 800 ms after a change.
 */
export default function StickyNoteCard({ instanceId, size, settings }: CardProps<StickySettings>) {
  const { value, update, hasUnsaved, status } = useCardSettings(instanceId, settings, 800)
  const editing = useNoteEditing(instanceId)
  const opened = useNoteOpened(instanceId)
  const NoteEditor = useEditorModule()?.default
  const root = useRef<HTMLDivElement>(null)
  const [startAt, setStartAt] = useState<StartAt | null>(null)
  const [tick, setTick] = useState<Tick | null>(null)

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

  useEffect(() => () => forgetNote(instanceId), [instanceId])

  // Editing waits for the editor's code; if it cannot load, the note stays as it reads.
  useEffect(() => {
    if (!opened || NoteEditor) return
    loadEditor().catch(() => {
      toast.error(m.sticky_open_failed(), { id: 'sticky-open-failed' })
      forgetNote(instanceId)
    })
  }, [opened, NoteEditor, instanceId])

  /** Starts editing with the cursor where the note was clicked. */
  const editAt = (event: MouseEvent) => {
    if (editing) return
    setStartAt({ x: event.clientX, y: event.clientY })
    setNoteEditing(instanceId, true)
  }

  // Ticking a read-only item rewrites the note by the editor's rules, so it loads the editor's
  // code (usually already there: hovering the note started loading it) without showing it.
  const toggle = (index: number, checked: boolean) => {
    const content = value.content
    setTick({ content, index, checked })
    loadEditor()
      .then(({ toggleTask }) => update({ content: toggleTask(content, index, checked) }))
      .catch(() => toast.error(m.sticky_save_failed()))
      .finally(() => setTick(null))
  }

  const view = (
    <NoteView
      content={value.content}
      placeholder={m.sticky_placeholder()}
      onToggle={toggle}
      tick={tick?.content === value.content ? tick : null}
    />
  )

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- pointer shortcuts; the header's edit button is the keyboard way in
    <div
      ref={root}
      className="relative flex h-full flex-col"
      style={{ backgroundColor: colorTint(value.color, 22) }}
      onPointerEnter={preloadEditor}
      onFocus={preloadEditor}
      onDoubleClick={editAt}
      onClick={(event) => {
        if (isEmpty(value.content)) editAt(event)
      }}
    >
      {opened && NoteEditor ? (
        <NoteEditor
          instanceId={instanceId}
          size={size}
          content={value.content}
          remote={settings.content}
          editing={editing}
          startAt={startAt}
          update={update}
          hasUnsaved={hasUnsaved}
        />
      ) : (
        // Until the note is first edited and the editor's code is there, it shows as it reads.
        <div className={SCROLL}>{view}</div>
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

/** The note's scrolling text area; the editor's `EditorContent` has the same classes. */
const SCROLL = 'min-h-0 flex-1 scroll-fade scrollbar-none overflow-y-auto px-4 py-3.5'
