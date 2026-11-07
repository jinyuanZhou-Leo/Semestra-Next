import { CalendarClock, ListChecks, type LucideIcon, Sparkles } from 'lucide-react'
import type { Message } from '@/app/extensions'
import { m } from '@/paraglide/messages'

export const NAMESPACE = 'notifications'

/** The fields of the `notifications` namespace grouped as the onboarding step shows them. */
export type Category = {
  id: string
  title: Message
  description: Message
  icon: LucideIcon
  fields: readonly string[]
}

export const CATEGORIES: readonly Category[] = [
  {
    id: 'schedule',
    title: m.notifications_category_schedule,
    description: m.notifications_category_schedule_description,
    icon: CalendarClock,
    fields: ['class_reminder', 'event_reminder'],
  },
  {
    id: 'tasks',
    title: m.notifications_category_tasks,
    description: m.notifications_category_tasks_description,
    icon: ListChecks,
    fields: ['task_reminder', 'daily_digest'],
  },
  {
    id: 'activity',
    title: m.notifications_category_activity,
    description: m.notifications_category_activity_description,
    icon: Sparkles,
    fields: ['jobs', 'assistant', 'sign_in'],
  },
]

/** Every field of the namespace in settings order (Settings → Notifications). */
export const REMINDER_FIELDS = ['class_reminder', 'event_reminder', 'task_reminder', 'daily_digest']
export const ACTIVITY_FIELDS = ['jobs', 'assistant', 'sign_in']
export const QUIET_FIELDS = ['quiet_hours', 'quiet_start', 'quiet_end']
export const ALL_FIELDS = [...REMINDER_FIELDS, ...ACTIVITY_FIELDS, ...QUIET_FIELDS]

/** A field's "nothing" value: off for the reminder choices, false for the switches. */
export function offValue(value: unknown): unknown {
  return typeof value === 'boolean' ? false : 'off'
}

export function isActive(value: unknown): boolean {
  return value !== false && value !== 'off'
}

/** The fields to hide so that a generated form shows only `fields`. */
export function hiddenExcept(fields: readonly string[]): string[] {
  return ALL_FIELDS.filter((field) => !fields.includes(field))
}
