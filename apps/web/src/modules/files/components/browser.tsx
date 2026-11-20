// What the list (`FileTable`) and grid (`FileGrid`) views of `FileBrowser` share.
import type { FolderOut, ItemOut } from '@semestra/api-client'
import { createContext, use } from 'react'
import { SelectCheckbox } from '@/components/row-selection'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { type DropTargets, dropTargetProps } from '../hooks'
import { type Target, targetKey } from '../folders'
import { useDragSource, useDropFolder } from './FileDrag'
import type { ItemAction } from './ItemDialogs'

export type BrowserHandlers = {
  /** Preview a file, or open a link (after the external-site check). */
  open: (item: ItemOut) => void
  openFolder: (folderId: string) => void
  act: (action: ItemAction) => void
  /** The course's Program, for the menu entries other modules add (`files.itemActions`). */
  programId?: string
  /**
   * Files dragged onto a folder go into it. Which folder they are over is not here but given to
   * the folder rows, so that dragging across the list renders those rows again, not every cell.
   */
  drop?: Omit<DropTargets, 'over'>
}

/**
 * What the cells do, read from this context: cells live at module level, or `FlexRender` would
 * remount them on every render. The checkboxes read `RowSelectionContext` instead, and each row
 * is a memoized component given whether it is selected, so checking one renders that row again
 * and the checkboxes, not every cell of every row.
 */
export const BrowserContext = createContext<BrowserHandlers | null>(null)

export function useHandlers(): BrowserHandlers {
  const handlers = use(BrowserContext)
  if (!handlers) throw new Error('File cells must render inside FileBrowser')
  return handlers
}

/** The mark of something not opened yet: the same dot as an unread announcement. */
export function NewDot({ className }: { className?: string }) {
  return (
    <span className={cn('size-2 shrink-0 rounded-full bg-primary', className)}>
      <span className="sr-only">{m.files_unseen()}</span>
    </span>
  )
}

/** The checkbox of a row or tile. */
export function SelectBox({ target, className }: { target: Target; className?: string }) {
  const name = target.type === 'item' ? target.item.display_name : target.folder.name
  return (
    <SelectCheckbox
      ids={[targetKey(target)]}
      label={m.files_select({ name })}
      className={className}
    />
  )
}

/** Drag-and-drop for a folder: it can be picked up, and takes files (uploads) and entries. */
export function useFolderDnd(folder: FolderOut, dropOver: boolean) {
  const { drop } = useHandlers()
  const target: Target = { type: 'folder', folder }
  const source = useDragSource(target)
  const into = useDropFolder(folder.id, folder.name, 'row')
  return {
    props: {
      ...dropTargetProps(folder.id, drop && { ...drop, over: dropOver ? folder.id : null }),
      ...source.listeners,
      ref: (node: HTMLElement | null) => {
        source.attach(node)
        into.attach(node)
      },
      'data-drop-target': dropOver || into.over ? '' : undefined,
    },
    moving: source.moving,
  }
}
