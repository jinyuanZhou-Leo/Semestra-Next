import type { Connection } from '@semestra/api-client'
import {
  lmsConnectionDeleteMutation,
  lmsConnectionListOptions,
  lmsConnectionValidateMutation,
  lmsProviderListOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { ChevronRight, Link2, Pencil, PlugZap, Plus, Trash2 } from 'lucide-react'
import { createContext, use, useState } from 'react'
import { toast } from 'sonner'
import { ActionRow, RowMenu, SettingsTable, settingsTableFeatures } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { errorMessage, toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/ui/item'
import { Skeleton } from '@/ui/skeleton'
import { Spinner } from '@/ui/spinner'
import { useOfferedProviders, useProviderName, useProviderUis } from '../providers'
import { invalidateLms } from '../queries'
import { ConnectionForm } from './ConnectionForm'

export function ConnectionStatus({ connection }: { connection: Connection }) {
  if (connection.status === 'error' || !connection.has_credentials) {
    const code = connection.last_error_code ?? 'lms.credentials_missing'
    return <Badge variant="destructive">{errorMessage({ error: { code, params: {} } })}</Badge>
  }
  if (connection.last_error_code) {
    // A transient failure (unreachable, rate limited) keeps the connection usable.
    const code = connection.last_error_code
    return <Badge variant="outline">{errorMessage({ error: { code, params: {} } })}</Badge>
  }
  return <Badge variant="secondary">{m.lms_connection_ok()}</Badge>
}

type RowHandlers = {
  checkingId: string | null
  onCheck: (connection: Connection) => void
  onEdit: (connection: Connection) => void
  onDelete: (connection: Connection) => void
}

const RowContext = createContext<RowHandlers | null>(null)

function useRowHandlers(): RowHandlers {
  const handlers = use(RowContext)
  if (!handlers) throw new Error('Connection cells render inside the connections table')
  return handlers
}

type CellProps = CellContext<typeof settingsTableFeatures, Connection>

function NameCell({ row }: CellProps) {
  const connection = row.original
  const ui = useProviderUis().get(connection.provider)
  const providerName = useProviderName(connection.provider)
  const Logo = ui?.logo ?? Link2
  const details = [
    providerName,
    ui?.summary?.(connection.config) ?? null,
    connection.account_name,
    ...Object.values(connection.credentials_hint),
  ].filter(Boolean)
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
        <Logo aria-hidden className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0">
        <div className="truncate font-medium">{connection.display_name}</div>
        <div className="truncate text-xs text-muted-foreground">{details.join(' · ')}</div>
      </div>
    </div>
  )
}

function UsageCell({ row }: CellProps) {
  const connection = row.original
  return (
    <span className="text-muted-foreground">
      {connection.program_ids.length > 0
        ? m.lms_connection_usage({
            programs: connection.program_ids.length,
            courses: connection.link_count,
          })
        : m.lms_connection_unused()}
    </span>
  )
}

function StatusCell({ row }: CellProps) {
  const { checkingId } = useRowHandlers()
  const connection = row.original
  // Two lines in every state (badge or spinner, then the last check), so checking a connection
  // never changes the row's height.
  return (
    <div className="flex flex-col items-start gap-0.5">
      <div className="flex h-5 items-center">
        {checkingId === connection.id ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner aria-hidden className="size-3.5" />
            {m.lms_connection_checking()}
          </span>
        ) : (
          <ConnectionStatus connection={connection} />
        )}
      </div>
      {connection.last_checked_at ? (
        <span className="text-xs text-muted-foreground">
          {m.lms_connection_checked_at({ time: formatDateTime(connection.last_checked_at) })}
        </span>
      ) : null}
    </div>
  )
}

function ActionsCell({ row }: CellProps) {
  const { checkingId, onCheck, onEdit, onDelete } = useRowHandlers()
  const connection = row.original
  return (
    <RowMenu label={m.lms_connection_actions({ name: connection.display_name })}>
      <DropdownMenuItem
        disabled={checkingId === connection.id || !connection.has_credentials}
        onClick={() => onCheck(connection)}
      >
        <PlugZap aria-hidden />
        {m.lms_connection_check()}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onEdit(connection)}>
        <Pencil aria-hidden />
        {m.common_edit()}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => onDelete(connection)}>
        <Trash2 aria-hidden />
        {m.common_delete()}
      </DropdownMenuItem>
    </RowMenu>
  )
}

const column = createColumnHelper<typeof settingsTableFeatures, Connection>()
const columns = column.columns([
  column.accessor((c) => c.display_name, {
    id: 'name',
    header: () => m.lms_connection_name(),
    cell: NameCell,
  }),
  column.display({ id: 'usage', header: () => m.lms_connection_used_by(), cell: UsageCell }),
  column.display({ id: 'status', header: () => m.lms_connection_status(), cell: StatusCell }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">{m.common_actions()}</span>,
    cell: ActionsCell,
  }),
])

const COLUMN_CLASS: Record<string, string> = {
  name: 'w-full max-w-0',
  usage: 'hidden whitespace-nowrap md:table-cell',
  status: 'whitespace-nowrap',
  actions: 'w-10',
}

/**
 * The first step of "Add connection": the platforms the server offers and the frontend has a
 * form for, from `lms.providerUi` (a step even with one platform, so the list grows in place).
 */
function ProviderPicker({ onPick }: { onPick: (kind: string) => void }) {
  const { providers, isPending } = useOfferedProviders()
  // One row's height while loading, so the dialog does not grow when the list arrives.
  if (isPending) return <Skeleton className="h-[4.5rem] w-full rounded-2xl" />
  if (providers.length === 0) {
    return (
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Link2 aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{m.lms_providers_empty()}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ItemGroup className="gap-2">
      {providers.map((ui) => (
        <Item
          key={ui.kind}
          variant="outline"
          // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the Item's children label it
          render={<button type="button" />}
          className="text-left"
          onClick={() => onPick(ui.kind)}
        >
          <ItemMedia variant="icon">
            <ui.logo aria-hidden className="size-5" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{ui.label()}</ItemTitle>
            {ui.description ? <ItemDescription>{ui.description()}</ItemDescription> : null}
          </ItemContent>
          <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
        </Item>
      ))}
    </ItemGroup>
  )
}

/** Remounted on every open (see `addKey`), so closing keeps the title through the exit animation. */
function AddConnectionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<string | null>(null)
  const name = useProviderName(kind)
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {kind && name
              ? m.lms_connection_add_provider({ provider: name })
              : m.lms_connection_add()}
          </DialogTitle>
          <DialogDescription>
            {kind ? m.lms_connection_note() : m.lms_connection_pick_provider()}
          </DialogDescription>
        </DialogHeader>
        {!open ? null : kind ? (
          <ConnectionForm key={kind} kind={kind} onSaved={onClose} onBack={() => setKind(null)} />
        ) : (
          <ProviderPicker onPick={setKind} />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Account settings → Integrations → LMS connections (M09 §7.1). Tokens are only shown masked. */
export function ConnectionsSection() {
  const queryClient = useQueryClient()
  const connections = useQuery(lmsConnectionListOptions())
  const [adding, setAdding] = useState(false)
  const [addKey, setAddKey] = useState(0)
  const startAdding = () => {
    setAddKey((k) => k + 1)
    setAdding(true)
  }
  // Fetched with the list, so the platform step opens with its rows already there.
  useQuery(lmsProviderListOptions())
  const [editing, setEditing] = useState<Connection | null>(null)
  const [deleting, setDeleting] = useState<Connection | null>(null)
  const check = useMutation({
    ...lmsConnectionValidateMutation(),
    onSuccess: async (result) => {
      await invalidateLms(queryClient, { all: true })
      if (result.ok) toast.success(m.lms_connection_check_ok())
      else
        toast.error(
          errorMessage({ error: { code: result.error_code, params: result.error_params ?? {} } }),
        )
    },
    onError: toastError,
  })
  const handlers: RowHandlers = {
    checkingId: check.isPending ? (check.variables?.body.connection_id ?? null) : null,
    onCheck: (connection) => check.mutate({ body: { connection_id: connection.id } }),
    onEdit: setEditing,
    onDelete: setDeleting,
  }
  const remove = useMutation({
    ...lmsConnectionDeleteMutation(),
    onSuccess: async () => {
      setDeleting(null)
      await invalidateLms(queryClient, { all: true })
    },
    onError: (err) => (setDeleting(null), toastError(err)),
  })

  return (
    <>
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
              <EmptyDescription>{m.lms_connections_empty_hint()}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={startAdding}>
                <Plus aria-hidden />
                {m.lms_connection_add()}
              </Button>
            </EmptyContent>
          </Empty>
        }
      >
        {(data) => (
          <RowContext value={handlers}>
            <SettingsTable
              label={m.lms_settings_connections()}
              data={data.items}
              columns={columns}
              getRowId={(connection) => connection.id}
              columnClassName={COLUMN_CLASS}
              footer={
                <ActionRow icon={Plus} onClick={startAdding}>
                  {m.lms_connection_add()}
                </ActionRow>
              }
            />
          </RowContext>
        )}
      </AsyncBoundary>
      <AddConnectionDialog key={addKey} open={adding} onClose={() => setAdding(false)} />
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m.lms_connection_edit()}</DialogTitle>
            <DialogDescription>{m.lms_connection_note()}</DialogDescription>
          </DialogHeader>
          {editing ? (
            <ConnectionForm
              key={editing.id}
              kind={editing.provider}
              connection={editing}
              onSaved={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={m.lms_connection_delete_title()}
        description={
          deleting && deleting.program_ids.length > 0
            ? m.lms_connection_delete_in_use({
                name: deleting.display_name,
                programs: deleting.program_ids.length,
                courses: deleting.link_count,
              })
            : m.lms_connection_delete_desc({ name: deleting?.display_name ?? '' })
        }
        confirmLabel={m.common_delete()}
        pending={remove.isPending}
        onConfirm={() =>
          deleting && remove.mutate({ path: { id: deleting.id }, query: { detach_all: true } })
        }
      />
    </>
  )
}
