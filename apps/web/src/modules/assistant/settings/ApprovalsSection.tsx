import type { AgentToolInfo } from '@semestra/api-client'
import { agentPreferenceGetOptions, agentToolListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { Eye, type LucideIcon, PencilLine, Trash2 } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { SettingsGroup, SettingsNote, useSettingsDialog } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Collapsible, CollapsibleContent } from '@/ui/collapsible'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { Switch } from '@/ui/switch'
import { EFFECT_TITLES, type ToolGroup, useToolGroups, useUpdatePreferences } from './shared'
import { FOLD_GROUP_CLASS, FoldTrigger, ToolItems } from './ToolList'

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
  return {
    on,
    total: tools.length,
    all: tools.length > 0 && on === tools.length,
    some: on > 0 && on < tools.length,
  }
}

/**
 * A switch for several tools at once. It is on only when all of them are; when some are, the
 * label beside it says "Partly on · 4/63", so an off switch never hides approved changes.
 */
function BulkSwitch({
  count,
  label,
  disabled,
  onChange,
}: {
  count: ReturnType<typeof countOn>
  label: string
  disabled?: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <span className="flex items-center gap-2">
      {count.some ? (
        <Badge variant="secondary" className="tabular-nums">
          {m.assistant_permissions_partial({ on: count.on, total: count.total })}
        </Badge>
      ) : (
        <span className="text-xs text-muted-foreground tabular-nums">
          {m.assistant_permissions_count({ on: count.on, total: count.total })}
        </span>
      )}
      <Switch
        aria-label={label}
        checked={count.all}
        disabled={disabled || count.total === 0}
        onCheckedChange={() => onChange(!count.all)}
      />
    </span>
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
          <FoldTrigger count={tools.length} describedBy={`${id}-title`} />
        </ItemActions>
      </Item>
      <CollapsibleContent>
        <div className="space-y-4 border-t bg-muted/30 px-4 py-3">
          {groups.map((group) => (
            <section key={group.id} aria-label={group.title} className="space-y-1.5">
              <div className="flex min-h-7 items-center justify-between gap-3">
                <h4 className="text-xs font-medium text-muted-foreground">{group.title}</h4>
                {renderModule?.(group)}
              </div>
              <ToolItems tools={group.tools} action={renderTool} />
            </section>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

type Bulk = { tools: readonly AgentToolInfo[]; module?: string }

/**
 * What the assistant (Sem) may do (M12 §6.2), by effect: reading never asks; changes can
 * be auto-approved all at once, per module or per tool; deleting always asks. Turning on several
 * changes at once asks first, since content Sem reads could then trigger all of them.
 */
export function ApprovalsSection() {
  const catalog = useQuery(agentToolListOptions())
  const preferences = useQuery(agentPreferenceGetOptions())
  const update = useUpdatePreferences()
  const settings = useSettingsDialog()
  // Kept after closing so the dialog keeps its text while it animates out.
  const [bulk, setBulk] = useState<Bulk | null>(null)
  const [confirming, setConfirming] = useState(false)
  const tools = catalog.data?.items ?? []
  const reads = tools.filter((tool) => tool.effect === 'read')
  // Memory tools never ask, so there is nothing to approve for them.
  const writes = tools.filter((tool) => tool.effect === 'write' && tool.confirm)
  const deletes = tools.filter((tool) => tool.effect === 'destructive')
  const chosen = new Set(preferences.data?.auto_approve ?? [])
  const setTools = (subset: readonly AgentToolInfo[], on: boolean) =>
    update({ auto_approve: withAll(chosen, subset, on) })
  const setMany = (next: Bulk, on: boolean) => {
    if (!on) return setTools(next.tools, false)
    setBulk(next)
    setConfirming(true)
  }
  const bulkCount = bulk?.tools.length ?? 0

  return (
    <AsyncBoundary query={catalog}>
      {() => (
        <AsyncBoundary query={preferences}>
          {() => (
            <div className="space-y-3">
              <SettingsGroup className={FOLD_GROUP_CLASS}>
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
                    <BulkSwitch
                      count={countOn(chosen, writes)}
                      label={m.assistant_permissions_auto_all()}
                      onChange={(on) => setMany({ tools: writes }, on)}
                    />
                  }
                  renderModule={(group) => (
                    <BulkSwitch
                      count={countOn(chosen, group.tools)}
                      label={m.assistant_permissions_auto_module({ module: group.title })}
                      onChange={(on) => setMany({ tools: group.tools, module: group.title }, on)}
                    />
                  )}
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
              <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title={
                  bulk?.module
                    ? m.assistant_permissions_confirm_module_title({
                        module: bulk.module,
                        count: bulkCount,
                      })
                    : m.assistant_permissions_confirm_all_title({ count: bulkCount })
                }
                description={m.assistant_permissions_confirm_description()}
                confirmLabel={m.assistant_permissions_confirm_label()}
                onConfirm={() => {
                  if (bulk) setTools(bulk.tools, true)
                  setConfirming(false)
                }}
              />
            </div>
          )}
        </AsyncBoundary>
      )}
    </AsyncBoundary>
  )
}
