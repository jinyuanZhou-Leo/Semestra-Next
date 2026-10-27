import type { AgentToolInfo } from '@semestra/api-client'
import { agentPreferenceGetOptions, agentToolListOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'
import { createColumnHelper } from '@tanstack/react-table'
import { Lock } from 'lucide-react'
import { createContext, use, useState } from 'react'
import {
  ChoiceControl,
  RowMenu,
  SettingRow,
  SettingsGroup,
  SettingsNote,
  SettingsTable,
  settingsTableFeatures,
} from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import { DropdownMenuItem } from '@/ui/dropdown-menu'
import { Item, ItemActions, ItemContent, ItemTitle } from '@/ui/item'
import { Switch } from '@/ui/switch'
import { capabilityTitle } from '../labels'
import { type ToolGroup, useToolGroups, useUpdatePreferences } from './shared'

type Mode = 'ask' | 'module' | 'auto'

/** The auto-approve list with every tool of `tools` turned on or off, the others kept. */
function withAll(chosen: ReadonlySet<string>, tools: readonly AgentToolInfo[], on: boolean) {
  const next = new Set(chosen)
  for (const tool of tools) {
    if (on) next.add(tool.name)
    else next.delete(tool.name)
  }
  return [...next].toSorted()
}

/** A rule that cannot be changed, such as "No approval needed", in place of a control. */
function Fixed({ children, locked }: { children: string; locked?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {locked ? <Lock aria-hidden className="size-3.5" /> : null}
      {children}
    </span>
  )
}

type ModuleRow = ToolGroup & { on: number }

type ModuleActions = {
  setTools: (tools: readonly AgentToolInfo[], on: boolean) => void
  choose: (group: ToolGroup) => void
}

const ModuleContext = createContext<ModuleActions | null>(null)

function useModuleActions() {
  const actions = use(ModuleContext)
  if (!actions) throw new Error('module rows render inside ApprovalsSection')
  return actions
}

function ModuleSwitch({ row }: { row: ModuleRow }) {
  const { setTools } = useModuleActions()
  const all = row.on === row.tools.length
  return (
    <div className="flex items-center justify-end gap-2">
      {row.on > 0 && !all ? (
        <Badge variant="secondary">{m.assistant_permissions_partial()}</Badge>
      ) : null}
      <Switch
        aria-label={m.assistant_permissions_auto_module({ module: row.title })}
        checked={all}
        onCheckedChange={(on) => setTools(row.tools, on)}
      />
    </div>
  )
}

function ModuleMenu({ row }: { row: ModuleRow }) {
  const { choose } = useModuleActions()
  return (
    <RowMenu label={m.common_more_actions()}>
      <DropdownMenuItem onClick={() => choose(row)}>
        {m.assistant_permissions_choose_tools()}
      </DropdownMenuItem>
    </RowMenu>
  )
}

function moduleSummary({ on, tools }: ModuleRow) {
  const total = tools.length
  if (on === 0) return m.assistant_permissions_module_none({ total })
  if (on === total) return m.assistant_permissions_module_all({ total })
  return m.assistant_permissions_module_some({ on, total })
}

const column = createColumnHelper<typeof settingsTableFeatures, ModuleRow>()

const columns = column.columns([
  column.accessor((row) => row.title, {
    id: 'name',
    header: () => m.assistant_permissions_module(),
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{row.original.title}</div>
        <div className="truncate text-xs text-muted-foreground">{moduleSummary(row.original)}</div>
      </div>
    ),
  }),
  column.display({
    id: 'auto',
    header: () => <span className="block text-right">{m.assistant_permissions_auto()}</span>,
    cell: ({ row }) => <ModuleSwitch row={row.original} />,
  }),
  column.display({
    id: 'menu',
    header: () => <span className="sr-only">{m.common_more_actions()}</span>,
    cell: ({ row }) => <ModuleMenu row={row.original} />,
  }),
])

/** One module's changes, each with its own switch. */
function ToolsDialog({
  group,
  open,
  onOpenChange,
  chosen,
  setTools,
}: {
  group: ToolGroup | null
  open: boolean
  onOpenChange: (open: boolean) => void
  chosen: ReadonlySet<string>
  setTools: (tools: readonly AgentToolInfo[], on: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {m.assistant_permissions_tools_title({ module: group?.title ?? '' })}
          </DialogTitle>
          <DialogDescription>{m.assistant_permissions_tools_description()}</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 max-h-[60vh] overflow-y-auto px-6">
          <SettingsGroup>
            {(group?.tools ?? []).map((tool) => (
              <Item key={tool.name} size="sm">
                <ItemContent className="min-w-0">
                  <ItemTitle>{capabilityTitle(tool.name)}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Switch
                    aria-label={capabilityTitle(tool.name)}
                    checked={chosen.has(tool.name)}
                    onCheckedChange={(on) => setTools([tool], on)}
                  />
                </ItemActions>
              </Item>
            ))}
          </SettingsGroup>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * What Sem may do without asking (M12 §6.2): reading never asks and deleting always does; changes
 * ask every time, are auto-approved by module (down to single actions), or are all auto-approved.
 * The three are one auto-approve list: empty, partial or full.
 */
export function ApprovalsSection() {
  const catalog = useQuery(agentToolListOptions())
  const preferences = useQuery(agentPreferenceGetOptions())
  const update = useUpdatePreferences()
  // "By module" picked while none or all are on; otherwise the mode follows the list.
  const [byModule, setByModule] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // Kept after closing so the dialog keeps its text while it animates out.
  const [chosenGroup, setChosenGroup] = useState<ToolGroup | null>(null)
  const [choosing, setChoosing] = useState(false)
  // Memory tools never ask, so there is nothing to approve for them.
  const writes = (catalog.data?.items ?? []).filter(
    (tool) => tool.effect === 'write' && tool.confirm,
  )
  const groups = useToolGroups(writes)
  const chosen = new Set(preferences.data?.auto_approve ?? [])
  const on = writes.filter((tool) => chosen.has(tool.name)).length
  const partial = on > 0 && on < writes.length
  const mode: Mode = byModule || partial ? 'module' : on > 0 ? 'auto' : 'ask'
  const setTools = (subset: readonly AgentToolInfo[], value: boolean) =>
    update({ auto_approve: withAll(chosen, subset, value) })
  const pick = (next: Mode) => {
    if (next === 'module') return setByModule(true)
    if (next === 'auto') return setConfirming(true)
    setByModule(false)
    // Clears the whole list, including actions of plugins that are not installed right now, so
    // reinstalling one does not bring back its auto-approvals.
    update({ auto_approve: [] })
  }
  const rows: ModuleRow[] = groups.map((group) => ({
    ...group,
    on: group.tools.filter((tool) => chosen.has(tool.name)).length,
  }))
  // Changes made in the table keep it open, even when they end up turning all or none on.
  const setModuleTools = (subset: readonly AgentToolInfo[], value: boolean) => {
    setByModule(true)
    setTools(subset, value)
  }
  const actions: ModuleActions = {
    setTools: setModuleTools,
    choose: (group) => {
      setChosenGroup(group)
      setChoosing(true)
    },
  }

  return (
    <AsyncBoundary query={catalog}>
      {() => (
        <AsyncBoundary query={preferences}>
          {() => (
            <div className="space-y-3">
              <SettingsGroup>
                <SettingRow
                  label={m.assistant_permissions_read()}
                  description={m.assistant_permissions_read_description()}
                >
                  <Fixed>{m.assistant_permissions_no_approval()}</Fixed>
                </SettingRow>
                <SettingRow
                  label={m.assistant_permissions_write()}
                  description={m.assistant_permissions_write_description()}
                >
                  {(labelId) => (
                    <ChoiceControl
                      labelId={labelId}
                      value={mode}
                      onChange={pick}
                      disabled={writes.length === 0}
                      options={[
                        { value: 'ask', label: m.assistant_permissions_mode_ask() },
                        { value: 'module', label: m.assistant_permissions_mode_module() },
                        { value: 'auto', label: m.assistant_permissions_mode_auto() },
                      ]}
                    />
                  )}
                </SettingRow>
                <SettingRow
                  label={m.assistant_permissions_destructive()}
                  description={m.assistant_permissions_destructive_description()}
                >
                  <Fixed locked>{m.assistant_permissions_mode_ask()}</Fixed>
                </SettingRow>
              </SettingsGroup>
              {mode === 'module' ? (
                <ModuleContext value={actions}>
                  <SettingsTable
                    label={m.assistant_permissions_modules()}
                    data={rows}
                    columns={columns}
                    getRowId={(row) => row.id}
                    columnClassName={{ name: 'w-full max-w-0', menu: 'w-12' }}
                  />
                </ModuleContext>
              ) : null}
              {mode === 'ask' ? null : (
                <SettingsNote>{m.assistant_settings_approvals_note()}</SettingsNote>
              )}
              <ToolsDialog
                group={chosenGroup}
                open={choosing}
                onOpenChange={setChoosing}
                chosen={chosen}
                setTools={setModuleTools}
              />
              <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title={m.assistant_permissions_confirm_all_title({ count: writes.length })}
                description={m.assistant_permissions_confirm_description()}
                confirmLabel={m.assistant_permissions_confirm_label()}
                onConfirm={() => {
                  setByModule(false)
                  setTools(writes, true)
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
