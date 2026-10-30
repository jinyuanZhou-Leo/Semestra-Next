import { Hash } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import CounterHeaderActions from './CounterHeaderActions'
import { counterSettingsSchema } from './schema'

/** M14 §1 计数器: a counter card with a range, a step and an optional ring. */
export default defineModule({
  id: 'counter',
  kind: 'plugin',
  name: m.counter_name,
  description: m.counter_description,
  icon: Hash,
  cards: [
    {
      id: 'counter.counter',
      scopes: ['program', 'term', 'course', 'today'],
      title: m.counter_card_title,
      icon: Hash,
      sizes: ['s', 'm'],
      defaultSize: 's',
      component: preloadable(() => import('./CounterCard')),
      settings: {
        schema: counterSettingsSchema,
        component: preloadable(() => import('./CounterSettingsForm')),
      },
      multiple: true,
      skeleton: 'stat',
      headerActions: CounterHeaderActions,
    },
  ],
})
