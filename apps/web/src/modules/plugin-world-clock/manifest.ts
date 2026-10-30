import { Globe } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { worldClockSettingsSchema } from './schema'

/** M14 §5 世界时钟: time and date in up to three zones. No backend. */
export default defineModule({
  id: 'world-clock',
  kind: 'plugin',
  name: m.world_clock_name,
  description: m.world_clock_description,
  icon: Globe,
  cards: [
    {
      id: 'clock.world',
      scopes: ['program', 'term', 'course', 'today'],
      title: m.world_clock_card_title,
      icon: Globe,
      sizes: ['s', 'm'],
      defaultSize: 's',
      component: preloadable(() => import('./WorldClockCard')),
      settings: {
        schema: worldClockSettingsSchema,
        component: preloadable(() => import('./WorldClockSettingsForm')),
      },
      multiple: true,
      skeleton: 'stat',
    },
  ],
})
