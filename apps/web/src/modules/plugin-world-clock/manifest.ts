import { Globe } from 'lucide-react'
import { lazy } from 'react'
import { defineModule } from '@/app/extensions'
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
      component: lazy(() => import('./WorldClockCard')),
      settings: {
        schema: worldClockSettingsSchema,
        component: lazy(() => import('./WorldClockSettingsForm')),
      },
      multiple: true,
    },
  ],
})
