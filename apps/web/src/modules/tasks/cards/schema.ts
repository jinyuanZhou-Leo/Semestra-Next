import { z } from 'zod'

/** Settings of the list card: a smart list (`today`, `all`…), `inbox` (shown as Unsorted), or `list:<id>`. */
export const listCardSettingsSchema = z.object({
  source: z.string().max(80).default('all'),
})

export type ListCardSettings = z.infer<typeof listCardSettingsSchema>
