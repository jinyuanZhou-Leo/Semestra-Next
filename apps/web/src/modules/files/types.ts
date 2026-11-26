import type { ItemOut } from '@semestra/api-client'
import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { Message } from '@/app/extensions'

/**
 * Extension point `files.itemActions` (M07 §6.1): more entries in a course file's "⋯" menu,
 * e.g. M09's "Open in Canvas". `accepts` picks the files it applies to.
 */
export type FileItemAction = {
  id: string
  /** The entry's text; a component, so it can name what it reads (the Program's platform). */
  Label: ComponentType<{ programId: string; item: ItemOut }>
  /** One line under the title. */
  description?: Message
  icon: LucideIcon
  accepts: (item: ItemOut) => boolean
  run: (ctx: { programId: string; item: ItemOut }) => Promise<void> | void
}

export const FILE_ITEM_ACTIONS = 'files.itemActions'

/**
 * Extension point `files.previewPanels` (M07 §6.1): a panel on the right of the file preview,
 * opened by an icon button in its title bar, e.g. M12's "Ask Sem" about the file. Like the
 * contents on the left, whether it is open is remembered (`files.preview_panel`), so the next
 * file opens with it too.
 */
export type FilePreviewPanel = {
  id: string
  /** The button's tooltip and the panel's name. */
  label: Message
  icon: LucideIcon
  /** The files it is offered for at all; others have no button. */
  accepts?: (item: ItemOut) => boolean
  /** Why it cannot be used for this file now (the button is disabled and says so), or null. */
  unavailable?: (item: ItemOut) => Message | null
  Panel: ComponentType<{
    item: ItemOut
    programId: string
    /** Opened with its button just now, not along with the file: it may take the focus. */
    focusInput: boolean
    onClose: () => void
  }>
}

export const FILE_PREVIEW_PANELS = 'files.previewPanels'
