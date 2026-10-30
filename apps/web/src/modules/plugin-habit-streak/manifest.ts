import { CalendarCheck, Flame } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { habitSettingsSchema } from './schema'

const settings = {
  schema: habitSettingsSchema,
  component: preloadable(() => import('./HabitSettingsForm')),
}

/** M14 §2 习惯打卡: a calendar card and a ring card over the same check-in data model. */
export default defineModule({
  id: 'habit-streak',
  kind: 'plugin',
  name: m.habit_name,
  description: m.habit_description,
  icon: Flame,
  cards: [
    {
      id: 'habit.board',
      scopes: ['program', 'term', 'course', 'today'],
      title: m.habit_board_title,
      icon: CalendarCheck,
      sizes: ['m', 'l', 'xl'],
      defaultSize: 'm',
      component: preloadable(() => import('./HabitBoardCard')),
      settings,
      multiple: true,
    },
    {
      id: 'habit.ring',
      scopes: ['program', 'term', 'course', 'today'],
      title: m.habit_ring_title,
      icon: Flame,
      sizes: ['s', 'm'],
      defaultSize: 's',
      component: preloadable(() => import('./HabitRingCard')),
      settings,
      multiple: true,
    },
  ],
})
