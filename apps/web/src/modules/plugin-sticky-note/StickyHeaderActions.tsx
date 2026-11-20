import { Check, Pencil } from 'lucide-react'
import type { CardProps } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { setNoteEditing, useNoteEditing } from './editing'
import type { StickySettings } from './schema'

/** The note's "edit" / "done" button in the card header (M14 §4). */
export default function StickyHeaderActions({ instanceId }: CardProps<StickySettings>) {
  const editing = useNoteEditing(instanceId)
  const label = editing ? m.sticky_done() : m.sticky_edit()
  const Icon = editing ? Check : Pencil
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            aria-pressed={editing}
            data-sticky-edit
            // Keeps the editor's focus, so "done" is not first undone by the editor losing it.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setNoteEditing(instanceId, !editing)}
            className="text-muted-foreground"
          />
        }
      >
        <Icon aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
