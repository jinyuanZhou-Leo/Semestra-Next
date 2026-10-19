import { z } from 'zod'
import { isValidZone } from '@/lib/zones'

export const MAX_ZONES = 3

/** World clock settings (M14 §5). With no zone chosen the card shows the browser's own zone. */
export const worldClockSettingsSchema = z.object({
  zones: z
    .array(z.string().min(1).max(64).refine(isValidZone, 'unknown time zone'))
    .max(MAX_ZONES)
    .default([]),
  show_seconds: z.boolean().default(false),
  show_offset: z.boolean().default(true),
  label: z.string().max(60).optional(),
})

export type WorldClockSettings = z.infer<typeof worldClockSettingsSchema>
