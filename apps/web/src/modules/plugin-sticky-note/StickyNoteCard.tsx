import { Bold, Italic, Link2, List, ListChecks, Pencil } from 'lucide-react'
import { type MouseEvent, useEffect, useRef, useState } from 'react'
import type { CardProps } from '@/app/extensions'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Textarea } from '@/ui/textarea'
import { colorTint } from '../plugin-kit/colors'
import { useCardSettings } from '../plugin-kit/useCardSettings'
import { type FormatKind, applyFormat } from './format'
import { Markdown } from './markdown'
import { NOTE_MAX_CHARS, type StickySettings } from './schema'

const TOOLS: [FormatKind, typeof Bold, () => string][] = [
  ['bold', Bold, m.sticky_format_bold],
  ['italic', Italic, m.sticky_format_italic],
  ['list', List, m.sticky_format_list],
  ['task', ListChecks, m.sticky_format_task],
  ['link', Link2, m.sticky_format_link],
]

/** Sticky note (M14 §4): click to edit the Markdown text in place; saved 800 ms after typing. */
export default function StickyNoteCard({ instanceId, size, settings }: CardProps<StickySettings>) {
  const { value, update, status } = useCardSettings(instanceId, settings, 800)
  const [editing, setEditing] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (editing) area.current?.focus()
  }, [editing])

  const format = (kind: FormatKind) => {
    const el = area.current
    if (!el) return
    const next = applyFormat(kind, {
      text: el.value,
      start: el.selectionStart,
      end: el.selectionEnd,
    })
    if (next.text.length > NOTE_MAX_CHARS) return
    update({ content: next.text })
    // The textarea re-renders with the new text; restore the selection after that.
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(next.start, next.end)
    })
  }
  // Toolbar buttons must not take focus from the textarea, or leaving it would end editing.
  const keepFocus = (event: MouseEvent) => event.preventDefault()

  const dot =
    status === 'error'
      ? 'bg-destructive'
      : status === 'saving'
        ? 'bg-muted-foreground'
        : 'bg-success'
  const dotLabel =
    status === 'error'
      ? m.sticky_save_failed()
      : status === 'saving'
        ? m.sticky_saving()
        : m.sticky_saved()

  return (
    <div
      className="relative flex h-full flex-col rounded-xl p-3"
      style={{ backgroundColor: colorTint(value.color, 22) }}
    >
      {editing ? (
        <>
          <Textarea
            ref={area}
            value={value.content}
            maxLength={NOTE_MAX_CHARS}
            aria-label={m.sticky_edit()}
            placeholder={m.sticky_placeholder()}
            onChange={(event) => update({ content: event.target.value })}
            onBlur={() => setEditing(false)}
            className="min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent p-0 text-sm field-sizing-fixed focus-visible:ring-0 dark:bg-transparent"
          />
          {size !== 's' ? (
            <div className="mt-1 flex gap-0.5">
              {TOOLS.map(([kind, Icon, label]) => (
                <Button
                  key={kind}
                  variant="ghost"
                  size="icon-xs"
                  aria-label={label()}
                  title={label()}
                  onMouseDown={keepFocus}
                  onClick={() => format(kind)}
                >
                  <Icon aria-hidden />
                </Button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        // Clicking anywhere edits; keyboard users use the pencil button.
        <div
          role="presentation"
          onClick={(event) => {
            // Checkboxes and links keep their own behavior.
            if (
              !(event.target as HTMLElement).closest('input, a, button, label, [role="checkbox"]')
            )
              setEditing(true)
          }}
          className="min-h-0 flex-1 cursor-text overflow-auto"
        >
          {value.content ? (
            <Markdown
              content={value.content}
              taskLabel={(text) => m.sticky_task_label({ text })}
              onToggleTask={(content) => update({ content })}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{m.sticky_placeholder()}</p>
          )}
        </div>
      )}
      {editing ? null : (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={m.sticky_edit()}
          title={m.sticky_edit()}
          onClick={() => setEditing(true)}
          className="absolute right-1 bottom-1 text-muted-foreground"
        >
          <Pencil aria-hidden />
        </Button>
      )}
      <output title={dotLabel} className="absolute top-2 right-2">
        <span className="sr-only">{dotLabel}</span>
        <span aria-hidden className={cn('block size-1.5 rounded-full', dot)} />
      </output>
    </div>
  )
}
