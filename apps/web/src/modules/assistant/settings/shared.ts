import type { AgentPreferencesOut, AgentToolInfo } from '@semestra/api-client'
import {
  agentPreferenceGetQueryKey,
  agentPreferenceUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useModules } from '@/app/registry'
import { useReportSectionStatus } from '@/app/settings'
import { m } from '@/paraglide/messages'

/**
 * Names for backend modules that provide tools but have no frontend module of their own (or one
 * under another id), so the lists never show a raw id like `layouts`.
 */
const BACKEND_MODULE_TITLES: Record<string, () => string> = {
  account: m.assistant_module_account,
  agent: m.assistant_module_agent,
  calendar: m.assistant_module_calendar,
  core: m.assistant_module_core,
  layouts: m.assistant_module_layouts,
}

/**
 * Tools listed under another module than the one that defines them, where that is the module a
 * user would look in: saving a chat attachment puts a file into a course.
 */
const TOOL_GROUPS: Record<string, string> = {
  'agent.attachment.save': 'files',
}

export type ToolGroup = { id: string; title: string; tools: AgentToolInfo[] }

/**
 * Tools by the module or plugin that provides them, named as the app names it: the modules with
 * the most tools first, plugins last.
 */
export function useToolGroups(tools: readonly AgentToolInfo[]): ToolGroup[] {
  const modules = useModules()
  const groups = new Map<string, ToolGroup>()
  for (const tool of tools) {
    const id = tool.plugin_id ?? TOOL_GROUPS[tool.name] ?? tool.module
    let group = groups.get(id)
    if (!group) {
      const title =
        modules.find((mod) => mod.id === id)?.name() ?? BACKEND_MODULE_TITLES[id]?.() ?? id
      group = { id, title, tools: [] }
      groups.set(id, group)
    }
    group.tools.push(tool)
  }
  const isPlugin = (group: ToolGroup) => group.tools.some((tool) => tool.plugin_id !== null)
  return [...groups.values()].toSorted(
    (a, b) => Number(isPlugin(a)) - Number(isPlugin(b)) || b.tools.length - a.tools.length,
  )
}

/** Saves the assistant preferences at once (the cache first), reporting beside the title. */
export function useUpdatePreferences() {
  const queryClient = useQueryClient()
  const report = useReportSectionStatus()
  const key = agentPreferenceGetQueryKey()
  const mutation = useMutation({
    ...agentPreferenceUpdateMutation(),
    onMutate: ({ body }) => {
      report({ status: 'saving' })
      const previous = queryClient.getQueryData<AgentPreferencesOut>(key)
      if (previous) queryClient.setQueryData(key, { ...previous, ...body })
      return { previous }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(key, data)
      report({ status: 'saved' })
    },
    onError: (_err, variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      report({ status: 'error', retry: () => mutation.mutate(variables) })
    },
  })
  return (body: Partial<Pick<AgentPreferencesOut, 'auto_approve' | 'mcp_allow_destructive'>>) =>
    mutation.mutate({ body })
}
