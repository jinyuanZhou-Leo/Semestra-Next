import type { Connection } from '@semestra/api-client'
import {
  lmsConnectionListOptions,
  lmsProgramBindingClearMutation,
  lmsProgramBindingGetOptions,
  lmsProgramBindingSetMutation,
  lmsSyncRequestMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Link2Off, type LucideIcon, RefreshCw, Replace, Settings2 } from 'lucide-react'
import { useState } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import { RowMenu, SettingRow, SettingsGroup, useSettingsDialog } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useNow } from '@/hooks/use-now'
import { toastError } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'
import { Spinner } from '@/ui/spinner'
import { useProviderUis } from '../providers'
import { invalidateTargets, programStateTargets } from '../queries'
import { syncStatusOptions, syncedAgo } from '../sync/status'
import { ConnectionItem } from './ConnectionItem'
import { ConnectionStatus } from './ConnectionsSection'

/** Opens account settings on the LMS connections, e.g. from a Program without one. */
export function useOpenConnections() {
  const settings = useSettingsDialog()
  return () => settings.open({ level: 'account', group: 'lms', section: 'lms-connections' })
}

/** Binds a Program to a connection, or clears it; what it changes is refetched. */
export function useProgramBinding(programId: string) {
  const queryClient = useQueryClient()
  // The binding's own event skips this tab (`realtimeSkipOwn`): refetched here.
  const done = {
    onSuccess: () => invalidateTargets(queryClient, programStateTargets(programId)),
    onError: toastError,
  }
  const set = useMutation({ ...lmsProgramBindingSetMutation(), ...done })
  const clear = useMutation({ ...lmsProgramBindingClearMutation(), ...done })
  return {
    bind: (connectionId: string, onDone?: () => void) =>
      set.mutate(
        { path: { program_id: programId }, body: { connection_id: connectionId } },
        { onSuccess: onDone },
      ),
    clear: (onDone?: () => void) =>
      clear.mutate({ path: { program_id: programId } }, { onSuccess: onDone }),
    pending: set.isPending || clear.isPending,
  }
}

/** The account's connections as select items, each with its platform's mark. */
function useConnectionItems(connections: readonly Connection[]) {
  const uis = useProviderUis()
  return connections.map((c) => ({
    value: c.id,
    label: c.display_name,
    Logo: uis.get(c.provider)?.logo ?? Link2,
  }))
}

/**
 * Program settings → LMS → Connection (M09 §7.1): the connection the Program's courses link
 * through, how its sync is going, and changing it, which waits until no course is linked.
 */
export function ProgramLmsSection({ scope }: SettingsSectionProps) {
  const programId = scope?.programId ?? ''
  const openConnections = useOpenConnections()
  const connections = useQuery(lmsConnectionListOptions())
  const binding = useQuery(lmsProgramBindingGetOptions({ path: { program_id: programId } }))

  return (
    <AsyncBoundary
      query={connections}
      isEmpty={(data) => data.items.length === 0}
      empty={
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Link2 aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.lms_connections_empty()}</EmptyTitle>
            <EmptyDescription>{m.lms_binding_needs_connection()}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={openConnections}>
              {m.lms_connection_add()}
            </Button>
          </EmptyContent>
        </Empty>
      }
    >
      {(data) => {
        const bound = data.items.find((c) => c.id === binding.data?.connection_id)
        if (!binding.data) return null
        return bound ? (
          <BoundConnection
            programId={programId}
            connection={bound}
            connections={data.items}
            linked={binding.data.link_count}
          />
        ) : (
          <ChooseConnection programId={programId} connections={data.items} />
        )
      }}
    </AsyncBoundary>
  )
}

function ChooseConnection({
  programId,
  connections,
}: {
  programId: string
  connections: readonly Connection[]
}) {
  const binding = useProgramBinding(programId)
  const items = useConnectionItems(connections)
  return (
    <SettingsGroup>
      <SettingRow label={m.lms_binding_label()} description={m.lms_binding_description()}>
        {(labelId) => (
          <Select
            value={null}
            items={items}
            disabled={binding.pending}
            onValueChange={(next) => (next ? binding.bind(next) : undefined)}
          >
            <SelectTrigger aria-labelledby={labelId} className="w-56">
              <SelectValue placeholder={m.lms_binding_placeholder()} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    <item.Logo aria-hidden />
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </SettingRow>
    </SettingsGroup>
  )
}

function BoundConnection({
  programId,
  connection,
  connections,
  linked,
}: {
  programId: string
  connection: Connection
  connections: readonly Connection[]
  /** Courses linked through it: while there are any, it cannot change. */
  linked: number
}) {
  const now = useNow()
  const openConnections = useOpenConnections()
  const status = useQuery(syncStatusOptions(programId)).data
  const binding = useProgramBinding(programId)
  // Runs in the background; the sync's status line tells how it went.
  const sync = useMutation({ ...lmsSyncRequestMutation(), onError: toastError })
  const [changing, setChanging] = useState(false)
  const [removing, setRemoving] = useState(false)
  const broken = connection.status === 'error' || !connection.has_credentials
  const locked = linked > 0
  const others = connections.filter((c) => c.id !== connection.id)

  return (
    <>
      <SettingsGroup>
        <ConnectionItem connection={connection}>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <ConnectionStatus connection={connection} />
            {status?.syncing ? (
              <span className="flex items-center gap-1.5">
                <Spinner aria-hidden className="size-3.5" />
                {m.lms_binding_syncing()}
              </span>
            ) : status?.synced_at && !broken ? (
              m.lms_sync_panel_synced({ ago: syncedAgo(status.synced_at, now) })
            ) : null}
          </span>
          <RowMenu label={m.lms_connection_actions({ name: connection.display_name })}>
            <DropdownMenuItem
              disabled={broken || sync.isPending || !locked}
              onClick={() =>
                sync.mutate({ path: { program_id: programId }, body: { force: true } })
              }
            >
              <RefreshCw aria-hidden />
              {m.lms_sync_now()}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openConnections}>
              <Settings2 aria-hidden />
              {m.lms_binding_manage()}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {others.length ? (
              <LockedItem
                locked={linked}
                icon={Replace}
                label={m.lms_binding_change_menu()}
                onClick={() => setChanging(true)}
              />
            ) : null}
            <LockedItem
              locked={linked}
              destructive
              icon={Link2Off}
              label={m.lms_binding_clear_menu()}
              onClick={() => setRemoving(true)}
            />
          </RowMenu>
        </ConnectionItem>
      </SettingsGroup>
      <ChangeConnectionDialog
        open={changing}
        onOpenChange={setChanging}
        connections={others}
        pending={binding.pending}
        onChange={(id) => binding.bind(id, () => setChanging(false))}
      />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={m.lms_binding_clear_title({ name: connection.display_name })}
        description={m.lms_binding_clear_desc()}
        confirmLabel={m.lms_binding_clear()}
        pending={binding.pending}
        onConfirm={() => binding.clear(() => setRemoving(false))}
      />
    </>
  )
}

/** A menu item that waits until no course is linked, and says so under its name. */
function LockedItem({
  locked,
  destructive,
  icon: Icon,
  label,
  onClick,
}: {
  locked: number
  destructive?: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <DropdownMenuItem
      disabled={locked > 0}
      variant={destructive ? 'destructive' : 'default'}
      onClick={onClick}
    >
      <Icon aria-hidden />
      {locked > 0 ? (
        <span className="flex flex-col">
          {label}
          <span className="text-xs text-muted-foreground">
            {m.lms_binding_locked_short({ count: locked })}
          </span>
        </span>
      ) : (
        label
      )}
    </DropdownMenuItem>
  )
}

function ChangeConnectionDialog({
  open,
  onOpenChange,
  connections,
  pending,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  connections: readonly Connection[]
  pending: boolean
  onChange: (connectionId: string) => void
}) {
  const items = useConnectionItems(connections)
  const [chosen, setChosen] = useState<string | null>(null)
  const value = chosen ?? items[0]?.value ?? null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{m.lms_binding_change_title()}</DialogTitle>
          <DialogDescription>{m.lms_binding_change_desc()}</DialogDescription>
        </DialogHeader>
        <Select value={value} items={items} onValueChange={setChosen}>
          <SelectTrigger aria-label={m.lms_binding_label()} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  <item.Logo aria-hidden />
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {m.common_cancel()}
          </Button>
          <Button
            disabled={!value || pending}
            onClick={() => (value ? onChange(value) : undefined)}
          >
            {m.lms_binding_change()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
