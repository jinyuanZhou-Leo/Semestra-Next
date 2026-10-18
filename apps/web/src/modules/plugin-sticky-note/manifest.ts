import { StickyNote } from 'lucide-react'
import { lazy } from 'react'
import { defineModule } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { stickySettingsSchema } from './schema'

/** M14 §4 便签: a Markdown note stored in the card's settings. */
export default defineModule({
  id: 'sticky-note',
  kind: 'plugin',
  name: m.sticky_name,
  description: m.sticky_description,
  icon: StickyNote,
  cards: [
    {
      id: 'sticky.note',
      scopes: ['program', 'term', 'course', 'today'],
      title: m.sticky_card_title,
      icon: StickyNote,
      sizes: ['s', 'm', 'l', 'xl'],
      defaultSize: 'm',
      component: lazy(() => import('./StickyNoteCard')),
      settings: {
        schema: stickySettingsSchema,
        component: lazy(() => import('./StickySettingsForm')),
      },
      multiple: true,
    },
  ],
})
