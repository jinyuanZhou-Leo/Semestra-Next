import { Timer } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { pomodoroSettingsSchema } from './schema'
import { usePomodoroStatus } from './status'

/** M14 §3 番茄钟: one timer card plus a status line while a timer runs. */
export default defineModule({
  id: 'pomodoro',
  kind: 'plugin',
  name: m.pomodoro_name,
  description: m.pomodoro_description,
  icon: Timer,
  cards: [
    {
      id: 'pomodoro.timer',
      scopes: ['program', 'term', 'course', 'today'],
      title: m.pomodoro_card_title,
      icon: Timer,
      sizes: ['s', 'm', 'l'],
      defaultSize: 'm',
      component: preloadable(() => import('./PomodoroCard')),
      settings: {
        schema: pomodoroSettingsSchema,
        component: preloadable(() => import('./PomodoroSettingsForm')),
      },
      multiple: false,
      skeleton: 'stat',
    },
  ],
  statusItems: [{ id: 'pomodoro.running', order: 50, useStatus: usePomodoroStatus }],
  uiPrefPrefixes: ['pomodoro.'],
})
