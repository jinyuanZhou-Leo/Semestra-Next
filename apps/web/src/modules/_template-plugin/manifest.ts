import { NotebookPen } from 'lucide-react'
import { lazy } from 'react'
import { defineModule } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { helloNoteCardSchema } from './schema'

/**
 * Plugin template (M14 §6): one Page, one Card with settings and one settings section.
 * `docs/plugin-authoring.md` explains every field. Copy this folder to `modules/plugin-<name>/`,
 * rename the ids and the `hello_` message keys, and add the manifest to `app/registry.ts`. The
 * template itself is not registered. The id must equal the backend `PLUGIN.id` (CI compares).
 */
export default defineModule({
  id: 'hello-note',
  kind: 'plugin',
  name: m.hello_name,
  description: m.hello_description,
  icon: NotebookPen,
  pages: [
    {
      id: 'hello-note',
      scopes: ['course'],
      title: m.hello_page_title,
      icon: NotebookPen,
      component: lazy(() => import('./HelloPage')),
      // Pages sort by `order` in the tab bar; plugins start at 1000 so core pages come first.
      order: 1000,
    },
  ],
  cards: [
    {
      id: 'hello.note',
      scopes: ['program', 'term', 'course', 'today'],
      title: m.hello_card_title,
      icon: NotebookPen,
      // Declare only sizes with a design. The first is what "add card" shows in the catalog.
      sizes: ['s', 'm', 'l'],
      defaultSize: 'm',
      component: lazy(() => import('./HelloNoteCard')),
      // With `settings.component` omitted the host builds a form from the schema.
      settings: { schema: helloNoteCardSchema },
      multiple: true,
    },
  ],
  // Generated from the backend namespace `plugin.hello-note`: no component to write. Field texts
  // are the messages `settings_plugin_hello_note_<field>_label|_description|_option_<value>`.
  settingsSections: [
    {
      id: 'hello-note',
      level: 'account',
      pluginId: 'hello-note',
      title: m.hello_settings_title,
      order: 1000,
      namespace: 'plugin.hello-note',
    },
  ],
})
