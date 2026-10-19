import type { AgentToolInfo } from '@semestra/api-client'
import { ChevronDown } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { SettingsGroup } from '@/app/settings'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { CollapsibleTrigger } from '@/ui/collapsible'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/ui/item'
import { capabilityTitle } from '../labels'

/** The rounded list classes for foldable groups: `overflow-hidden` keeps row backgrounds inside the corners. */
export const FOLD_GROUP_CLASS = 'overflow-hidden rounded-2xl border'

/** The "63 tools ⌄" button that opens a folded list; sits in a row's `ItemActions`. */
export function FoldTrigger({ count, describedBy }: { count: number; describedBy?: string }) {
  return (
    <CollapsibleTrigger
      render={
        <Button
          variant="ghost"
          size="sm"
          className="group/trigger text-muted-foreground"
          aria-describedby={describedBy}
          disabled={count === 0}
        />
      }
    >
      {m.assistant_permissions_tools({ count })}
      <ChevronDown
        aria-hidden
        className="transition-transform group-data-[panel-open]/trigger:rotate-180"
      />
    </CollapsibleTrigger>
  )
}

function ToolItem({
  tool,
  action,
}: {
  tool: AgentToolInfo
  action?: (tool: AgentToolInfo, labelId: string) => ReactNode
}) {
  const labelId = `${useId()}-title`
  return (
    <Item size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle id={labelId}>{capabilityTitle(tool.name)}</ItemTitle>
        <ItemDescription className="truncate">{tool.summary}</ItemDescription>
      </ItemContent>
      {action ? <ItemActions>{action(tool, labelId)}</ItemActions> : null}
    </Item>
  )
}

/** Tools as a list of small items, each with an optional control labelled by its title. */
export function ToolItems({
  tools,
  action,
}: {
  tools: readonly AgentToolInfo[]
  action?: (tool: AgentToolInfo, labelId: string) => ReactNode
}) {
  return (
    <SettingsGroup className={`${FOLD_GROUP_CLASS} rounded-xl bg-background`}>
      {tools.map((tool) => (
        <ToolItem key={tool.name} tool={tool} action={action} />
      ))}
    </SettingsGroup>
  )
}
