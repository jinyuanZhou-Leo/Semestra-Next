import { Flame } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { habitSettingsSchema } from './schema'

const settings = {
  schema: habitSettingsSchema,
  component: preloadable(() => import('./HabitSettingsForm')),
}

/**
 * M14 §2 习惯打卡: one card per habit. The ring checks in today; at m and l the card also shows the
 * past weeks. The old calendar card `habit.board` was folded into it (migration 0027).
 */
export default defineModule({
  id: 'habit-streak',
  kind: 'plugin',
  name: m.habit_name,
  description: m.habit_description,
  icon: Flame,
  cards: [
    {
      id: 'habit.ring',
      scopes: ['program', 'term', 'course', 'today'],
      title: m.habit_ring_title,
      icon: Flame,
      sizes: ['s', 'm', 'l'],
      defaultSize: 's',
      component: preloadable(() => import('./HabitRingCard')),
      settings,
      multiple: true,
    },
  ],
})
