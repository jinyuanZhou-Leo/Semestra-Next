import { StickyNote } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
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
      component: preloadable(() => import('./StickyNoteCard')),
      settings: {
        schema: stickySettingsSchema,
        component: preloadable(() => import('./StickySettingsForm')),
      },
      multiple: true,
      skeleton: 'text',
    },
  ],
})
