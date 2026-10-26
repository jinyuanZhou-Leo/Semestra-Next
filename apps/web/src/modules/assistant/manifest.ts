import { Bookmark, ListChecks, MessageCircle, Plug, Trash2, Wrench } from 'lucide-react'
import { defineModule, scopePath, preloadable } from '@/app/extensions'
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
    open: (ctx, question) => {
      if (question) return panel.open(question)
      const page = panel.page()
      if (!page) return panel.toggle()
      // On the full page the panel is not shown: the conversation moves to it, and the user goes
      // back to where they came from.
      panel.moveHere(page.sessionId, page.temporary, panel.pageDraft())
      ctx.navigate(
        panel.returnTo() ?? scopePath({ kind: 'program', programId: ctx.programId ?? '' }, 'today'),
      )
    },
    panel: { subscribe: panel.subscribe, isOpen: () => panel.get().open },
    Dock: AssistantDock,
    SidebarNav: preloadable(() =>
      import('./components/SessionNav').then((mod) => ({ default: mod.SessionNav })),
    ),
  },
  settingsSections: [
    {
      id: 'assistant-conversation',
      level: 'account',
      group: 'ai-models',
      title: m.assistant_settings_conversation,
      description: m.assistant_settings_conversation_description,
      icon: MessageCircle,
      order: 30,
      namespace: 'assistant',
    },
    {
      id: 'assistant-approvals',
      level: 'account',
      group: 'ai-permissions',
      title: m.assistant_settings_approvals,
      description: m.assistant_settings_approvals_description,
      icon: ListChecks,
      order: 20,
      component: preloadable(() => settings().then((s) => ({ default: s.ApprovalsSection }))),
    },
    {
      id: 'assistant-memory-enabled',
      level: 'account',
      group: 'ai-memory',
      title: m.assistant_settings_memory,
      description: m.assistant_settings_memory_description,
      icon: Bookmark,
      order: 10,
      namespace: 'memory',
    },
    {
      id: 'assistant-memories',
      level: 'account',
      group: 'ai-memory',
      title: m.assistant_settings_memories,
      description: m.assistant_settings_memories_description,
      icon: Bookmark,
      order: 20,
      component: preloadable(() => settings().then((s) => ({ default: s.MemorySection }))),
    },
    {
      id: 'assistant-memory-clear',
      level: 'account',
      group: 'ai-memory',
      title: m.settings_danger_zone,
      danger: true,
      icon: Trash2,
      order: 900,
      component: preloadable(() => settings().then((s) => ({ default: s.ClearMemoriesSection }))),
    },
    {
      id: 'assistant-mcp',
      level: 'account',
      group: 'ai-mcp',
      title: m.assistant_settings_mcp,
      description: m.assistant_settings_mcp_description,
      icon: Plug,
      order: 21,
      component: preloadable(() => settings().then((s) => ({ default: s.McpSection }))),
    },
    {
      id: 'assistant-tools',
      level: 'account',
      group: 'ai-mcp',
      title: m.assistant_settings_tools,
      description: m.assistant_settings_tools_description,
      icon: Wrench,
      order: 22,
      component: preloadable(() => settings().then((s) => ({ default: s.ToolsSection }))),
    },
  ],
  realtimeInvalidations: {
    // A new title. During a turn the chat already has it from the turn's events, and reading
    // the conversation again then would overwrite what is streaming in.
    'agent.session.updated': [
      (data) =>
        data.during_turn
          ? ['agentSessionList']
          : ['agentSessionList', { _id: 'agentSessionGet', path: { id: data.session_id } }],
    ],
    'plugins.installed': ['agentToolList', 'agentSkillList'],
    'plugins.uninstalled': ['agentToolList', 'agentSkillList'],
  },
})
