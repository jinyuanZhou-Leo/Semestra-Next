import type { AgentToolInfo } from '@semestra/api-client'
import { agentToolsCatalogOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { SettingsGroup } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { Badge } from '@/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import { capabilityTitle } from '../labels'
import { EFFECT_TITLES, type ToolGroup, useToolGroups } from './shared'

const EFFECTS: readonly AgentToolInfo['effect'][] = ['read', 'write', 'destructive']

/** "Read 5 · Change 3 · Delete 1" for one module's tools. */
function effectSummary(tools: readonly AgentToolInfo[]): string {
  return EFFECTS.map((effect) => [effect, tools.filter((t) => t.effect === effect).length] as const)
    .filter(([, count]) => count > 0)
    .map(([effect, count]) => `${EFFECT_TITLES[effect]()} ${count}`)
    .join(' · ')
}

function ModuleTools({ group }: { group: ToolGroup }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group/trigger flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{group.title}</span>
          <span className="block text-xs text-muted-foreground">{effectSummary(group.tools)}</span>
        </span>
        <ChevronDown
          aria-hidden
          className="size-4 text-muted-foreground transition-transform group-data-[panel-open]/trigger:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="divide-y border-t bg-muted/30">
          {group.tools.map((tool) => (
            <li key={tool.name} className="flex items-center justify-between gap-3 px-4 py-2">
              <div className="min-w-0">
                <p className="text-sm">{capabilityTitle(tool.name)}</p>
                <p className="truncate text-xs text-muted-foreground">{tool.summary}</p>
              </div>
              <Badge variant={tool.effect === 'destructive' ? 'destructive' : 'secondary'}>
                {EFFECT_TITLES[tool.effect]()}
              </Badge>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Everything 小森 / Sem and MCP clients can do (M12 §6.2), one folded row per module. Read-only;
 * what runs without asking is set under Assistant permissions.
 */
export function ToolsSection() {
  const catalog = useQuery(agentToolsCatalogOptions())
  const groups = useToolGroups(catalog.data?.items ?? [])
  return (
    <AsyncBoundary query={catalog}>
      {() => (
        <SettingsGroup>
          {groups.map((group) => (
            <ModuleTools key={group.id} group={group} />
          ))}
        </SettingsGroup>
      )}
    </AsyncBoundary>
  )
}
