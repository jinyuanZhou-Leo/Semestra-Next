import type { AgentPreferencesOut, AgentToolInfo } from '@semestra/api-client'
import {
  agentPreferencesGetQueryKey,
  agentPreferencesUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useModules } from '@/app/registry'
import { useReportSectionStatus } from '@/app/settings'
import { m } from '@/paraglide/messages'

export const EFFECT_TITLES: Record<AgentToolInfo['effect'], () => string> = {
  read: m.assistant_effect_read,
  write: m.assistant_effect_write,
  destructive: m.assistant_effect_destructive,
}

export type ToolGroup = { id: string; title: string; tools: AgentToolInfo[] }

/** Tools by the module or plugin that provides them, named as the app names it. */
export function useToolGroups(tools: readonly AgentToolInfo[]): ToolGroup[] {
  const modules = useModules()
  const groups = new Map<string, ToolGroup>()
  for (const tool of tools) {
    const id = tool.plugin_id ?? tool.module
    let group = groups.get(id)
    if (!group) {
      const title = modules.find((mod) => mod.id === id)?.name() ?? id
      group = { id, title, tools: [] }
      groups.set(id, group)
    }
    group.tools.push(tool)
  }
  return [...groups.values()]
}

/** Saves the assistant preferences at once (the cache first), reporting beside the title. */
export function useUpdatePreferences() {
  const queryClient = useQueryClient()
  const report = useReportSectionStatus()
  const key = agentPreferencesGetQueryKey()
  const mutation = useMutation({
    ...agentPreferencesUpdateMutation(),
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
