import { Keyboard, LayoutGrid, PanelTop, Pencil, Plus, Puzzle } from 'lucide-react'
import { lazy } from 'react'
import { hasHostAction, runHostAction } from '@/app/commands'
import { defineModule } from '@/app/extensions'
import { m } from '@/paraglide/messages'

/**
 * M10 插件与布局, the user-facing part: the plugin catalog in account settings. Boards, the page
 * tab bar, the command palette, shortcuts and the status bar live in `app/` (the host).
 */
export default defineModule({
  id: 'plugins',
  kind: 'core',
  name: m.plugins_name,
  description: m.plugins_description,
  icon: Puzzle,
  settingsSections: [
    {
      id: 'plugins',
      level: 'account',
      group: 'plugins',
      title: m.plugins_section_title,
      description: m.plugins_section_description,
      icon: Puzzle,
      order: 10,
      component: lazy(() => import('./PluginCatalog')),
    },
  ],
  commands: [
    {
      id: 'board.add-card',
      title: m.board_add_card,
      keywords: ['card', 'widget', '卡片'],
      icon: Plus,
      isAvailable: () => hasHostAction('board.add'),
      run: () => void runHostAction('board.add'),
    },
    {
      id: 'board.edit',
      title: m.board_edit,
      keywords: ['layout', '布局'],
      icon: Pencil,
      hotkey: 'e',
      isAvailable: () => hasHostAction('board.edit'),
      run: () => void runHostAction('board.edit'),
    },
    {
      id: 'nav.manage-pages',
      title: m.host_nav_manage_pages,
      keywords: ['tabs', 'pages', '标签', '页面'],
      icon: PanelTop,
      isAvailable: () => hasHostAction('nav.manage'),
      run: () => void runHostAction('nav.manage'),
    },
    {
      id: 'plugins.manage',
      title: m.plugins_manage,
      keywords: ['plugins', 'install', '插件'],
      icon: LayoutGrid,
      isAvailable: () => hasHostAction('settings.plugins'),
      run: () => void runHostAction('settings.plugins'),
    },
    {
      id: 'hotkeys.help',
      title: m.hotkeys_title,
      keywords: ['keyboard', 'shortcuts', '快捷键'],
      icon: Keyboard,
      hotkey: '?',
      run: () => void runHostAction('hotkeys.help'),
    },
  ],
  realtimeInvalidations: {
    'plugins.installed': ['pluginsCatalogList', 'layoutsBoardGet'],
    'plugins.uninstalled': ['pluginsCatalogList', 'layoutsBoardGet'],
    'layouts.board.updated': ['layoutsBoardGet'],
    'layouts.card.deleted': ['layoutsBoardGet'],
    'layouts.card.settings_updated': ['layoutsBoardGet', 'layoutsCardGetSettings'],
    'layouts.nav.updated': ['layoutsNavGet'],
    'layouts.template.updated': ['layoutsTemplateGet', 'layoutsBoardGet'],
  },
})
