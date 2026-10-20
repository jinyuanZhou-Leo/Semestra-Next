import { ListChecks, MessageCircle, Plug, Wrench } from 'lucide-react'
import { lazy } from 'react'
import { defineModule } from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { AssistantDock } from './components/AssistantDock'
import { panel } from './store'

const settings = () => import('./settings/sections')

/**
 * M12 AI 助手 (shown as Sem): the side panel (`Cmd/Ctrl + J`) and full page, confirmation cards for writes, and
 * the settings for auto-approval, MCP and the tool catalog. The app shell docks the panel through
 * `assistant.Dock`.
 */
export default defineModule({
  id: 'assistant',
  kind: 'core',
  name: m.assistant_name,
  description: m.assistant_description,
  icon: MessageCircle,
  assistant: {
    open: (_ctx, question) => (question ? panel.open(question) : panel.toggle()),
    panel: { subscribe: panel.subscribe, isOpen: () => panel.get().open },
    Dock: AssistantDock,
    SidebarNav: lazy(() =>
      import('./components/SessionNav').then((mod) => ({ default: mod.SessionNav })),
    ),
  },
  settingsSections: [
    {
      id: 'assistant-approvals',
      level: 'account',
      group: 'ai-permissions',
      title: m.assistant_settings_approvals,
      description: m.assistant_settings_approvals_description,
      icon: ListChecks,
      order: 20,
      component: lazy(() => settings().then((s) => ({ default: s.ApprovalsSection }))),
    },
    {
      id: 'assistant-mcp',
      level: 'account',
      group: 'ai-mcp',
      title: m.assistant_settings_mcp,
      description: m.assistant_settings_mcp_description,
      icon: Plug,
      order: 21,
      component: lazy(() => settings().then((s) => ({ default: s.McpSection }))),
    },
    {
      id: 'assistant-tools',
      level: 'account',
      group: 'ai-mcp',
      title: m.assistant_settings_tools,
      description: m.assistant_settings_tools_description,
      icon: Wrench,
      order: 22,
      component: lazy(() => settings().then((s) => ({ default: s.ToolsSection }))),
    },
  ],
  realtimeInvalidations: {
    'plugins.installed': ['agentToolsCatalog', 'agentSkillsList'],
    'plugins.uninstalled': ['agentToolsCatalog', 'agentSkillsList'],
  },
})
