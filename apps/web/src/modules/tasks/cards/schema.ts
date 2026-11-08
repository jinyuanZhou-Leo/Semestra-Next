import { z } from 'zod'
import { type CardSettings, preloadable } from '@/app/extensions'

/** Settings of the list card: a smart list (`today`, `all`…), `inbox` (shown as Unsorted), or `list:<id>`. */
export const listCardSettingsSchema = z.object({
  source: z.string().max(80).default('all'),
})

export type ListCardSettings = z.infer<typeof listCardSettingsSchema>

/** The card's settings (`CardContribution.settings`), loaded with the card. */
export default {
  schema: listCardSettingsSchema,
  component: preloadable(() => import('./ListCardSettings')),
} satisfies CardSettings
