import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { Message } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel } from '@/ui/dropdown-menu'

type Source<P> = {
  id: string
  icon: LucideIcon
  title: Message
  /** Shown instead of `title` when the name depends on loaded data (M09's platform name). */
  Title?: ComponentType<P>
  description?: Message
}

/**
 * The "From existing material" part of an "Add" menu: the import sources other modules
 * contribute (a syllabus, a calendar file, the LMS), each with one line on what it brings in.
 * Put it after the menu's own add items and a separator, or alone in an empty state's menu.
 */
export function ImportSourceItems<P extends object, S extends Source<P>>({
  sources,
  onPick,
  titleProps,
}: {
  sources: readonly S[]
  onPick: (source: S) => void
  /** What a source's `Title` is rendered with. */
  titleProps?: P
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{m.common_add_from_sources()}</DropdownMenuLabel>
      {sources.map((source) => (
        <DropdownMenuItem key={source.id} onClick={() => onPick(source)}>
          <source.icon aria-hidden />
          <span className="min-w-0">
            <span className="block">
              {source.Title && titleProps ? <source.Title {...titleProps} /> : source.title()}
            </span>
            {source.description ? (
              <span className="block text-xs text-muted-foreground">{source.description()}</span>
            ) : null}
          </span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  )
}
