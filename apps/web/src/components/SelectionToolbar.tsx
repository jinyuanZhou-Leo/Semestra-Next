import type { ReactNode } from 'react'
import { useHotkey } from '@/app/hotkeys'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Kbd } from '@/ui/kbd'

/** Layers that take Esc for themselves: dialogs, menus, popovers, list boxes. */
const POPUP =
  '[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[data-slot=popover-content]'

/**
 * Esc belongs to whatever is open on top of the table: a dialog, a menu, a popover (closing it
 * must not also drop the selection). It is the selection's only when nothing else took it.
 */
function escTakenElsewhere(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return true
  const target = event.target
  if (target instanceof Element && target.closest(POPUP)) return true
  return document.querySelector(`:is(${POPUP})[data-open]`) !== null
}

const LAYER =
  'col-start-1 row-start-1 flex min-w-0 items-center gap-2 transition-[opacity,translate] duration-150 ease-out motion-reduce:transition-none'

/**
 * The part of a table's toolbar that its batch actions replace while rows are checked (M00
 * §4.8): the filters and search (`children`) give way to the count, then the actions (one button
 * each, the destructive one last) and "Clear selection" after them. Both sit in one grid cell, so the row
 * keeps its height and the table never moves; they cross-fade, and the hidden one is `inert`.
 * Esc clears the selection unless a dialog, menu or popover is open (Esc closes that instead).
 */
export function SelectionToolbar({
  count,
  countLabel,
  label,
  onClear,
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
  actions: ReactNode
  /** What the toolbar shows when nothing is checked: filters, search. */
  children: ReactNode
  className?: string
}) {
  const selecting = count > 0
  useHotkey('escape', onClear, { enabled: selecting, ignoreEventWhen: escTakenElsewhere })
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
        <span className="mr-2 font-medium whitespace-nowrap tabular-nums">{countLabel}</span>
        {actions}
        <Button variant="secondary" size="sm" aria-keyshortcuts="Escape" onClick={onClear}>
          {m.common_clear_selection()}
          <Kbd aria-hidden>Esc</Kbd>
        </Button>
      </div>
    </div>
  )
}
