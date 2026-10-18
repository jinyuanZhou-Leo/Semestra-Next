import { z } from 'zod'

export const COUNTER_LABEL_MAX = 60

/** Counter card settings (M14 §1). `value` is the current count, stored with the settings. */
export const counterSettingsSchema = z
  .object({
    label: z.string().max(COUNTER_LABEL_MAX).default(''),
    min: z.number().int().default(0),
    max: z.number().int().default(10),
    step: z.number().int().min(1).default(1),
    initial: z.number().int().default(0),
    show_ring: z.boolean().default(true),
    value: z.number().int().optional(),
  })
  .refine((s) => s.min < s.max, { path: ['max'], message: 'range' })
  .refine((s) => s.initial >= s.min && s.initial <= s.max, {
    path: ['initial'],
    message: 'initial',
  })

export type CounterSettings = z.infer<typeof counterSettingsSchema>
