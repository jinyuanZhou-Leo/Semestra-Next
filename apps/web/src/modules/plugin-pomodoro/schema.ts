import { z } from 'zod'

/** Pomodoro card settings (M14 §3) and the course a focus session is spent on (large size). */
export const pomodoroSettingsSchema = z.object({
  focus_min: z.number().int().min(1).max(180).default(25),
  short_break_min: z.number().int().min(1).max(60).default(5),
  long_break_min: z.number().int().min(1).max(120).default(15),
  long_break_every: z.number().int().min(2).max(12).default(4),
  auto_start_next: z.boolean().default(false),
  sound: z.boolean().default(true),
  notify: z.boolean().default(true),
  course_id: z.string().max(64).optional(),
})

export type PomodoroSettings = z.infer<typeof pomodoroSettingsSchema>
