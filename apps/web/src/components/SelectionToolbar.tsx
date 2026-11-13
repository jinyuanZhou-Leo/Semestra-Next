import type { ReactNode } from 'react'
import { useHotkey } from '@/app/hotkeys'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Kbd } from '@/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'

const LAYER =
  'col-start-1 row-start-1 flex min-w-0 items-center gap-2 transition-[opacity,translate] duration-150 ease-out motion-reduce:transition-none'

/**
 * The part of a table's toolbar that its batch actions replace while rows are checked (M00
 * §4.8): the filters and search (`children`) give way to the count, "Clear selection" and the
 * actions, one button each with the destructive one last. Both sit in one grid cell, so the row
 * keeps its height and the table never moves; they cross-fade, and the hidden one is `inert`.
 * Esc clears the selection unless `paused` (a dialog of the batch is open).
 */
export function SelectionToolbar({
  count,
  countLabel,
  label,
  onClear,
  paused = false,
  actions,
  children,
  className,
}: {
  /** Checked rows on screen; the actions show while there is one. */
  count: number
  /** "3 selected", in the table's words ("3 courses"). */
  countLabel: string
  /** What the actions act on, for screen readers ("Actions on the selected courses"). */
  label: string
  onClear: () => void
  paused?: boolean
  actions: ReactNode
  /** What the toolbar shows when nothing is checked: filters, search. */
  children: ReactNode
  className?: string
}) {
  const selecting = count > 0
  useHotkey('escape', onClear, { enabled: selecting && !paused })
  return (
    <div className={cn('grid min-w-0', className)}>
      <div
        inert={selecting}
        className={cn(LAYER, selecting && 'pointer-events-none -translate-y-1 opacity-0')}
      >
        {children}
      </div>
      <div
        role="toolbar"
        aria-label={label}
        inert={!selecting}
        className={cn(
          LAYER,
          'text-sm',
          !selecting && 'pointer-events-none translate-y-1 opacity-0',
        )}
      >
        <span className="font-medium whitespace-nowrap tabular-nums">{countLabel}</span>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="sm" onClick={onClear} />}>
            {m.common_clear_selection()}
          </TooltipTrigger>
          <TooltipContent>
            <Kbd>Esc</Kbd>
          </TooltipContent>
        </Tooltip>
        <div className="ml-2 flex items-center gap-2">{actions}</div>
      </div>
    </div>
  )
}
