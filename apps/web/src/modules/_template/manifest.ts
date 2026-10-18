import { Blocks, HardDrive, House, ListChecks } from 'lucide-react'
import { lazy } from 'react'
import { defineModule } from '@/app/extensions'
import { m } from '@/paraglide/messages'

/**
 * Module template (M00 §1): a page, a card, a settings section and a command, all backed by real
 * core APIs. Copy this folder to `modules/<id>/`, rename the ids and message keys, and add the
 * manifest to `app/registry.ts`. The template itself is not registered.
 */
export default defineModule({
  id: 'template',
  kind: 'plugin',
  name: m.template_name,
  description: m.template_description,
  icon: Blocks,
  pages: [
    {
      id: 'template',
      scopes: ['program', 'term', 'course'],
      title: m.template_page_title,
      icon: ListChecks,
      component: lazy(() => import('./TemplatePage')),
      order: 1000,
    },
  ],
  cards: [
    {
      id: 'template.storage',
      scopes: ['program', 'term', 'course'],
      title: m.template_card_storage_title,
      icon: HardDrive,
      sizes: ['s', 'm'],
      defaultSize: 'm',
      component: lazy(() => import('./StorageCard')),
      multiple: false,
    },
  ],
  settingsSections: [
    {
      id: 'template',
      level: 'account',
      title: m.template_settings_title,
      order: 1000,
      component: lazy(() => import('./TemplateSettings')),
    },
  ],
  commands: [{ id: 'template.home', title: m.template_command_home, icon: House, to: '/' }],
  // Events this module's backend publishes → queries to refetch (core.job.progress is handled
  // by the core, see app/realtime.ts).
  realtimeInvalidations: { 'template.countdown.finished': ['coreJobList'] },
})
