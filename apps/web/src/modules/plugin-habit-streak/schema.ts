import { z } from 'zod'
import { COLOR_TOKENS } from '../plugin-kit/colors'

/** Icons a habit can use: a short list of lucide names, so the bundle keeps only these. */
export const HABIT_ICONS = [
  'target',
  'book-open',
  'dumbbell',
  'droplets',
  'moon',
  'sun',
  'pencil',
  'music',
  'code',
  'coffee',
  'apple',
  'brain',
  'heart',
  'footprints',
  'bike',
  'languages',
  'leaf',
  'flame',
  'star',
  'smile',
] as const

export type HabitIconName = (typeof HABIT_ICONS)[number]

/** Same defaults as the backend (`habit_streak/schemas.py`). */
export const habitSettingsSchema = z.object({
  name: z.string().max(60).default(''),
  icon: z.enum(HABIT_ICONS).default('target'),
  goal: z.enum(['daily', 'weekly']).default('daily'),
  weekly_target: z.number().int().min(1).max(7).default(3),
  color: z.enum(COLOR_TOKENS).default('primary'),
  show_toast: z.boolean().default(true),
})

export type HabitSettings = z.infer<typeof habitSettingsSchema>
