import { agentToolsCatalogOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { SettingsBlock, SettingsGroup } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { Badge } from '@/ui/badge'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/ui/item'
import { capabilityTitle } from '../labels'
import { EFFECT_TITLES, useToolGroups } from './shared'

/** Everything the assistant (and MCP clients) can do, by module (M12 §6.2). Read-only. */
export function ToolsSection() {
  const catalog = useQuery(agentToolsCatalogOptions())
  const groups = useToolGroups(catalog.data?.items ?? [])
  return (
    <AsyncBoundary query={catalog}>
      {() => (
        <div className="space-y-6">
          {groups.map((group) => (
            <SettingsBlock key={group.id} title={group.title}>
              <SettingsGroup>
                {group.tools.map((tool) => (
                  <Item key={tool.name} size="sm">
                    <ItemContent>
                      <ItemTitle>{capabilityTitle(tool.name)}</ItemTitle>
                      <ItemDescription>{tool.summary}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Badge variant={tool.effect === 'destructive' ? 'destructive' : 'secondary'}>
                        {EFFECT_TITLES[tool.effect]()}
                      </Badge>
                    </ItemActions>
                  </Item>
                ))}
              </SettingsGroup>
            </SettingsBlock>
          ))}
        </div>
      )}
    </AsyncBoundary>
  )
}
