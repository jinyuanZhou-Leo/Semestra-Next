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
 * opened by an icon button in its title bar, e.g. M12's "Ask Sem" about the file. The preview
 * remembers, per file, which one was open, so reopening the file brings it back.
 */
export type FilePreviewPanel = {
  id: string
  /** The button's tooltip and the panel's name. */
  label: Message
  icon: LucideIcon
  accepts?: (item: ItemOut) => boolean
  Panel: ComponentType<{ item: ItemOut; programId: string; onClose: () => void }>
}

export const FILE_PREVIEW_PANELS = 'files.previewPanels'
