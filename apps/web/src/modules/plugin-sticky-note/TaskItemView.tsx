import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { m } from '@/paraglide/messages'
import { Checkbox } from '@/ui/checkbox'

/**
 * A checklist row: shadcn's checkbox instead of the browser's (the row stays editable text).
 * `NoteView` draws the same row for a read-only note.
 */
export function TaskItemView({ node, updateAttributes }: ReactNodeViewProps) {
  const checked = node.attrs.checked === true
  return (
    <NodeViewWrapper as="li" data-checked={checked}>
      <span contentEditable={false} className="flex h-[1lh] items-center">
        <Checkbox
          checked={checked}
          aria-label={m.sticky_task_label({ text: node.firstChild?.textContent ?? '' })}
          onCheckedChange={(next) => updateAttributes({ checked: next === true })}
        />
      </span>
      <NodeViewContent as="div" />
    </NodeViewWrapper>
  )
}
