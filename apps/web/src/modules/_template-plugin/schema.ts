import { z } from 'zod'
import type { CardSettings } from '@/app/extensions'

/**
 * Settings of one hello note card. The host validates them with this schema before they reach the
 * card, and the backend validates the same shape on save (M10 §4). Give every field a default so
 * that cards created before a field existed still parse.
 */
export const helloNoteCardSchema = z.object({
  title: z.string().max(60).default(''),
  text: z.string().max(2000).default(''),
})

export type HelloNoteCardSettings = z.infer<typeof helloNoteCardSchema>

/** The card's settings (`CardContribution.settings`), loaded with the card. */
export default {
  schema: helloNoteCardSchema,
} satisfies CardSettings
