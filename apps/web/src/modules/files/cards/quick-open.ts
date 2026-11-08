import { z } from 'zod'
import { type CardSettings, preloadable } from '@/app/extensions'

export const quickOpenSchema = z.object({
  /** Chosen files and links, in the order they were picked. */
  item_ids: z.array(z.string()).max(24).default([]),
})

export type QuickOpenSettings = z.infer<typeof quickOpenSchema>

/** The card's settings (`CardContribution.settings`), loaded with the card. */
export default {
  schema: quickOpenSchema,
  component: preloadable(() =>
    import('./QuickOpenPicker').then((module) => ({ default: module.QuickOpenPicker })),
  ),
} satisfies CardSettings
