import type { AgentToolInfo } from '@semestra/api-client'
import { agentToolsCatalogOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { SettingsGroup } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { Badge } from '@/ui/badge'
import { Collapsible, CollapsibleContent } from '@/ui/collapsible'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/ui/item'
import { EFFECT_TITLES, type ToolGroup, useToolGroups } from './shared'
import { FOLD_GROUP_CLASS, FoldTrigger, ToolItems } from './ToolList'

const EFFECTS: readonly AgentToolInfo['effect'][] = ['read', 'write', 'destructive']

/** "Read 5 · Change 3 · Delete 1" for one module's tools. */
function effectSummary(tools: readonly AgentToolInfo[]): string {
  return EFFECTS.map((effect) => [effect, tools.filter((t) => t.effect === effect).length] as const)
    .filter(([, count]) => count > 0)
    .map(([effect, count]) => `${EFFECT_TITLES[effect]()} ${count}`)
    .join(' · ')
}

function ModuleTools({ group }: { group: ToolGroup }) {
  const titleId = `${useId()}-title`
  return (
    <Collapsible>
      <Item>
        <ItemContent className="min-w-0">
          <ItemTitle id={titleId}>{group.title}</ItemTitle>
          <ItemDescription>{effectSummary(group.tools)}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <FoldTrigger count={group.tools.length} describedBy={titleId} />
        </ItemActions>
      </Item>
      <CollapsibleContent>
        <div className="border-t bg-muted/30 px-4 py-3">
          <ToolItems
            tools={group.tools}
            action={(tool) => (
              <Badge variant={tool.effect === 'destructive' ? 'destructive' : 'secondary'}>
                {EFFECT_TITLES[tool.effect]()}
              </Badge>
            )}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Everything Sem and MCP clients can do (M12 §6.2), one folded row per module. Read-only;
 * what runs without asking is set under Assistant permissions.
 */
export function ToolsSection() {
  const catalog = useQuery(agentToolsCatalogOptions())
  const groups = useToolGroups(catalog.data?.items ?? [])
  return (
    <AsyncBoundary query={catalog}>
      {() => (
        <SettingsGroup className={FOLD_GROUP_CLASS}>
          {groups.map((group) => (
            <ModuleTools key={group.id} group={group} />
          ))}
        </SettingsGroup>
      )}
    </AsyncBoundary>
  )
}
