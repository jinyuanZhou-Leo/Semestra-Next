import { z } from 'zod'
import type { CardSettings } from '@/app/extensions'

export const SHORTCUT_PLACES = [
  'last',
  'home',
  'announcements',
  'syllabus',
  'modules',
  'assignments',
  'pages',
  'files',
] as const

export const shortcutSchema = z.object({
  /** Where the card opens the Canvas tab: where the user left it, or one of its views. */
  place: z.enum(SHORTCUT_PLACES).default('last'),
})

export type ShortcutSettings = z.infer<typeof shortcutSchema>

export default { schema: shortcutSchema } satisfies CardSettings
