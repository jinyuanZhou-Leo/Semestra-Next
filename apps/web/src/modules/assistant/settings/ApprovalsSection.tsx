import type { AgentToolInfo } from '@semestra/api-client'
import {
  agentPreferencesGetOptions,
  agentToolsCatalogOptions,
} from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Eye, type LucideIcon, PencilLine, Trash2 } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { SettingsGroup, SettingsNote, useSettingsDialog } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { Label } from '@/ui/label'
import { Switch } from '@/ui/switch'
import { capabilityTitle } from '../labels'
import { EFFECT_TITLES, type ToolGroup, useToolGroups, useUpdatePreferences } from './shared'

type Effect = AgentToolInfo['effect']
type RenderTool = (tool: AgentToolInfo, labelId: string) => ReactNode

const EFFECT_ICONS: Record<Effect, LucideIcon> = {
  read: Eye,
  write: PencilLine,
  destructive: Trash2,
}

const EFFECT_DESCRIPTIONS: Record<Effect, () => string> = {
  read: m.assistant_permissions_read_description,
  write: m.assistant_permissions_write_description,
  destructive: m.assistant_permissions_destructive_description,
}

/** The auto-approve list with every tool of `tools` turned on or off, the others kept. */
function withAll(chosen: ReadonlySet<string>, tools: readonly AgentToolInfo[], on: boolean) {
  const next = new Set(chosen)
  for (const tool of tools) {
    if (on) next.add(tool.name)
    else next.delete(tool.name)
  }
  return [...next].toSorted()
}

/** How many of `tools` run without asking: all, some (mixed) or none. */
function countOn(chosen: ReadonlySet<string>, tools: readonly AgentToolInfo[]) {
  const on = tools.filter((tool) => chosen.has(tool.name)).length
  return { on, total: tools.length, all: tools.length > 0 && on === tools.length }
}

// Switches stay default-size: a `data-size="sm"` child would change the gaps of the
// surrounding `ItemGroup` (`has-data-[size=sm]:gap-2.5`) and make the rows jump when opened.
function ToolLine({ tool, renderTool }: { tool: AgentToolInfo; renderTool?: RenderTool }) {
  const labelId = `${useId()}-label`
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <Label id={labelId} className="text-sm font-normal">
          {capabilityTitle(tool.name)}
        </Label>
        <p className="truncate text-xs text-muted-foreground">{tool.summary}</p>
      </div>
      {renderTool?.(tool, labelId)}
    </li>
  )
}

/**
 * One kind of effect (read, change, delete): what it means, its rule or master switch, and the
 * tools it covers by module, folded away until asked for.
 */
function EffectPanel({
  effect,
  tools,
  control,
  footer,
  renderTool,
  renderModule,
}: {
  effect: Effect
  tools: readonly AgentToolInfo[]
  control: ReactNode
  footer?: ReactNode
  renderTool?: RenderTool
  renderModule?: (group: ToolGroup) => ReactNode
}) {
  const id = useId()
  const groups = useToolGroups(tools)
  const Icon = EFFECT_ICONS[effect]
  return (
    <Collapsible>
      <Item>
        <ItemMedia variant="icon">
          <Icon aria-hidden />
        </ItemMedia>
        <ItemContent className="min-w-0 basis-56">
          <ItemTitle id={`${id}-title`}>{EFFECT_TITLES[effect]()}</ItemTitle>
          <ItemDescription>{EFFECT_DESCRIPTIONS[effect]()}</ItemDescription>
          {footer}
        </ItemContent>
        <ItemActions className="shrink-0 gap-3">
          {control}
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="group/trigger text-muted-foreground"
                aria-describedby={`${id}-title`}
                disabled={tools.length === 0}
              />
            }
          >
            {m.assistant_permissions_tools({ count: tools.length })}
            <ChevronDown
              aria-hidden
              className="transition-transform group-data-[panel-open]/trigger:rotate-180"
            />
          </CollapsibleTrigger>
        </ItemActions>
      </Item>
      <CollapsibleContent>
        <div className="space-y-4 border-t bg-muted/30 px-4 py-3">
          {groups.map((group) => (
            <section key={group.id} aria-label={group.title} className="space-y-1">
              <div className="flex min-h-7 items-center justify-between gap-3">
                <h4 className="text-xs font-medium text-muted-foreground">{group.title}</h4>
                {renderModule?.(group)}
              </div>
              <ul className="divide-y rounded-xl border bg-background">
                {group.tools.map((tool) => (
                  <ToolLine key={tool.name} tool={tool} renderTool={renderTool} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * What the assistant (小森 / Sem) may do without asking (M12 §6.2), by effect: reading never
 * asks; changes can be auto-approved all at once, per module or per tool; deleting always asks.
 */
export function ApprovalsSection() {
  const catalog = useQuery(agentToolsCatalogOptions())
  const preferences = useQuery(agentPreferencesGetOptions())
  const update = useUpdatePreferences()
  const settings = useSettingsDialog()
  const tools = catalog.data?.items ?? []
  const reads = tools.filter((tool) => tool.effect === 'read')
  const writes = tools.filter((tool) => tool.effect === 'write')
  const deletes = tools.filter((tool) => tool.effect === 'destructive')
  const chosen = new Set(preferences.data?.auto_approve ?? [])
  const all = countOn(chosen, writes)
  const setTools = (subset: readonly AgentToolInfo[], on: boolean) =>
    update({ auto_approve: withAll(chosen, subset, on) })

  return (
    <AsyncBoundary query={catalog}>
      {() => (
        <AsyncBoundary query={preferences}>
          {() => (
            <div className="space-y-3">
              <SettingsGroup>
                <EffectPanel
                  key="read"
                  effect="read"
                  tools={reads}
                  control={
                    <Badge variant="secondary">{m.assistant_permissions_no_confirm()}</Badge>
                  }
                />
                <EffectPanel
                  key="write"
                  effect="write"
                  tools={writes}
                  control={
                    <>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {m.assistant_permissions_count({ on: all.on, total: all.total })}
                      </span>
                      {/* Mixed or off turns every change on; all on turns them all off. */}
                      <Switch
                        aria-label={m.assistant_permissions_auto_all()}
                        checked={all.all}
                        disabled={writes.length === 0}
                        onCheckedChange={() => setTools(writes, !all.all)}
                      />
                    </>
                  }
                  renderModule={(group) => {
                    const mod = countOn(chosen, group.tools)
                    return (
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {mod.on}/{mod.total}
                        </span>
                        <Switch
                          aria-label={m.assistant_permissions_auto_module({ module: group.title })}
                          checked={mod.all}
                          onCheckedChange={() => setTools(group.tools, !mod.all)}
                        />
                      </span>
                    )
                  }}
                  renderTool={(tool, labelId) => (
                    <Switch
                      aria-labelledby={labelId}
                      checked={chosen.has(tool.name)}
                      onCheckedChange={(checked) => setTools([tool], checked)}
                    />
                  )}
                />
                <EffectPanel
                  key="destructive"
                  effect="destructive"
                  tools={deletes}
                  control={<Badge variant="outline">{m.assistant_permissions_always_asks()}</Badge>}
                  footer={
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto self-start p-0 text-xs"
                      onClick={() => settings.select('ai-mcp', 'assistant-mcp')}
                    >
                      {m.assistant_permissions_mcp_link()}
                    </Button>
                  }
                />
              </SettingsGroup>
              <SettingsNote>{m.assistant_settings_approvals_note()}</SettingsNote>
            </div>
          )}
        </AsyncBoundary>
      )}
    </AsyncBoundary>
  )
}
