import { Check, LayoutTemplate, MoreHorizontal, Pencil, Plus } from 'lucide-react'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { runHostAction, useHasHostAction } from '../commands/bus'
import { formatHotkey } from '../hotkeys'
import { useMediaQuery } from './media'

/**
 * The board's edit controls, driven through the host actions the board registers (see
 * `commands/bus.ts`) so the page header can host them: the header swaps its buttons for these
 * while a board is edited, and nothing around the grid moves.
 */

/** The "Edit layout" icon button; absent unless a board is on screen outside edit mode. */
export function EditLayoutButton() {
  const shown = useHasHostAction('board.shown')
  const canEdit = useHasHostAction('board.edit')
  if (!shown) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m.board_edit()}
            disabled={!canEdit}
            onClick={() => runHostAction('board.edit')}
            data-tour="board-edit"
          />
        }
      >
        <Pencil aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{`${m.board_edit()} (${formatHotkey('e')})`}</TooltipContent>
    </Tooltip>
  )
}

/** Whether a board on screen is being edited. */
export function useBoardEditing(): boolean {
  return useHasHostAction('board.editing')
}

/** "Add card", the default-layout menu and "Done". */
export function BoardEditActions() {
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => runHostAction('board.add')}>
        <Plus aria-hidden />
        {m.board_add_card()}
      </Button>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="icon-sm" aria-label={m.board_default_menu()} />
                }
              />
            }
          >
            <MoreHorizontal aria-hidden />
          </TooltipTrigger>
          <TooltipContent>{m.board_default_menu()}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => runHostAction('board.default.save')}>
              <LayoutTemplate aria-hidden />
              {m.board_default_save()}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => runHostAction('board.default.restore')}>
              {m.board_default_restore()}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => runHostAction('board.default.reset')}>
              {m.board_default_reset()}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" onClick={() => runHostAction('board.done')}>
        <Check aria-hidden />
        {m.board_done()}
      </Button>
    </>
  )
}

/** One line telling how to edit; the short form on screens where cards cannot be dragged. */
export function useBoardEditHint(): string {
  const wide = useMediaQuery('(min-width: 1024px)')
  return wide ? m.board_editing_hint() : m.board_editing_hint_narrow()
}
