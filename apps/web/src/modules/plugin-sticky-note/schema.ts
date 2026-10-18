import { z } from 'zod'

export const NOTE_MAX_CHARS = 10_000

/** The six note colors (M14 §4): palette tokens, tinted so text stays readable in both themes. */
export const NOTE_COLORS = [
  'subject-3',
  'subject-4',
  'subject-7',
  'subject-8',
  'subject-10',
  'subject-11',
] as const

export const stickySettingsSchema = z.object({
  content: z.string().max(NOTE_MAX_CHARS).default(''),
  color: z.enum(NOTE_COLORS).default('subject-3'),
})

export type StickySettings = z.infer<typeof stickySettingsSchema>
