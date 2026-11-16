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
