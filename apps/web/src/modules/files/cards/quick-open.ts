import { z } from 'zod'

export const quickOpenSchema = z.object({
  /** Chosen files and links, in the order they were picked. */
  item_ids: z.array(z.string()).max(24).default([]),
})

export type QuickOpenSettings = z.infer<typeof quickOpenSchema>
