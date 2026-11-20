import type { TokenOut } from '@semestra/api-client'
import {
  accountTokenListOptions,
  accountTokenListQueryKey,
  accountTokenRevokeMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { Ban, History, KeyRound, Plus, Unplug } from 'lucide-react'
import { createContext, use, useState } from 'react'
import { RowMenu, SectionAction, SettingsTable, settingsTableFeatures } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { apiUrl } from '@/lib/api-extras'
import { useDialogTarget } from '@/lib/dialog-target'
import { toastError } from '@/lib/errors'
import { formatDate, formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { AddConnectionDialog, ClientTile } from './AddConnectionDialog'
import { ChangesDialog, changesOptions } from './ChangesDialog'
import { clientOf } from './mcp-clients'

type RowActions = {
  revoke: (token: TokenOut) => void
  showChanges: (token: TokenOut) => void
  /** Starts reading a connection's changes when its menu item is pointed at. */
  prepareChanges: (token: TokenOut) => void
}

const RowActionsContext = createContext<RowActions>({
  revoke: () => {},
  showChanges: () => {},
  prepareChanges: () => {},
})

type CellProps = CellContext<typeof settingsTableFeatures, TokenOut>

function NameCell({ row }: CellProps) {
  const t = row.original
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ClientTile client={clientOf(t)} />
      <div className="min-w-0">
        <div className="truncate font-medium">{t.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {[
            // A pasted token goes by its first characters; an app that signed in has none.
            t.kind === 'oauth' ? m.assistant_mcp_signed_in() : `${t.prefix}…`,
            t.last_used_at
              ? m.auth_account_tokens_last_used({ time: formatDateTime(t.last_used_at) })
              : m.auth_account_tokens_never_used(),
            t.expires_at
              ? m.auth_account_tokens_expires_at({ time: formatDate(t.expires_at) })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
    </div>
  )
}

function ActionsCell({ row }: CellProps) {
  const actions = use(RowActionsContext)
  const token = row.original
  // A read-only connection cannot change anything.
  const writes = token.scopes.includes('write')
  return (
    <RowMenu label={m.auth_account_tokens_actions({ name: token.name })}>
      {writes
        ? [
            <DropdownMenuItem
              key="changes"
              onPointerEnter={() => actions.prepareChanges(token)}
              onFocus={() => actions.prepareChanges(token)}
              onClick={() => actions.showChanges(token)}
            >
              <History aria-hidden />
              {m.assistant_mcp_changes()}
            </DropdownMenuItem>,
            <DropdownMenuSeparator key="separator" />,
          ]
        : null}
      <DropdownMenuItem variant="destructive" onClick={() => actions.revoke(token)}>
        {token.kind === 'oauth' ? <Unplug aria-hidden /> : <Ban aria-hidden />}
        {token.kind === 'oauth' ? m.assistant_mcp_disconnect() : m.auth_account_tokens_revoke()}
      </DropdownMenuItem>
    </RowMenu>
  )
}

const column = createColumnHelper<typeof settingsTableFeatures, TokenOut>()
const columns = column.columns([
  column.accessor((t) => t.name, {
    id: 'name',
    header: () => m.auth_account_tokens_name_label(),
    cell: NameCell,
  }),
  column.display({
    id: 'scope',
    header: () => m.auth_account_tokens_scope_label(),
    cell: ({ row }) => (
      <Badge variant="secondary">
        {row.original.scopes.includes('write')
          ? m.auth_account_tokens_scope_write()
          : m.auth_account_tokens_scope_read()}
      </Badge>
    ),
  }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">{m.common_actions()}</span>,
    cell: ActionsCell,
  }),
])

const COLUMN_CLASS: Record<string, string> = {
  scope: 'whitespace-nowrap',
  actions: 'w-10',
}

/**
 * Connected clients and API tokens (M12 §5): one list, since every connection is an API token
 * named after its client or an app that signed in, and one way to add either.
 */
export function ConnectionsSection() {
  // Clients run outside the browser: same-origin deployments need the page's origin.
  const url = new URL(apiUrl('/mcp'), window.location.origin).href
  const queryClient = useQueryClient()
  const tokens = useQuery(accountTokenListOptions())
  const [adding, setAdding] = useState(false)
  const revoking = useDialogTarget<TokenOut>()
  // Whether "Recent changes" has anything once no connection can write (revoked ones' changes).
  const allChanges = useQuery(changesOptions(null))
  const changes = useDialogTarget<{ tokenId: string | null }>()
  const actions: RowActions = {
    revoke: (t) => revoking.show(t),
    showChanges: (t) => changes.show({ tokenId: t.id }),
    prepareChanges: (t) => void queryClient.prefetchQuery(changesOptions(t.id)),
  }
  const items = tokens.data?.items ?? []

  const refresh = () => queryClient.invalidateQueries({ queryKey: accountTokenListQueryKey() })
  const revoke = useMutation({
    ...accountTokenRevokeMutation(),
    onSuccess: () => {
      revoking.close()
      void refresh()
    },
    onError: (err) => (revoking.close(), toastError(err)),
  })

  return (
    <>
      <SectionAction>
        {items.some((t) => t.scopes.includes('write')) || allChanges.data?.items.length ? (
          <Button size="sm" variant="outline" onClick={() => changes.show({ tokenId: null })}>
            <History aria-hidden />
            {m.assistant_mcp_changes()}
          </Button>
        ) : null}
        {items.length > 0 ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {m.assistant_mcp_add()}
          </Button>
        ) : null}
      </SectionAction>
      <AsyncBoundary
        query={tokens}
        isEmpty={(page) => page.items.length === 0}
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <KeyRound aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.assistant_mcp_empty()}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                {m.assistant_mcp_add()}
              </Button>
            </EmptyContent>
          </Empty>
        }
      >
        {(page) => (
          <RowActionsContext value={actions}>
            <SettingsTable
              fill="name"
              label={m.auth_account_tokens_title()}
              data={page.items}
              columns={columns}
              getRowId={(t) => t.id}
              columnClassName={COLUMN_CLASS}
            />
          </RowActionsContext>
        )}
      </AsyncBoundary>
      <AddConnectionDialog open={adding} onOpenChange={setAdding} url={url} />
      <ChangesDialog {...changes.props} target={changes.target} tokens={items} />
      <ConfirmDialog
        {...revoking.props}
        {...(revoking.target?.kind === 'oauth'
          ? {
              title: m.assistant_mcp_disconnect_title({ client: revoking.target.name }),
              description: m.assistant_mcp_disconnect_desc({ client: revoking.target.name }),
              confirmLabel: m.assistant_mcp_disconnect(),
            }
          : {
              title: m.auth_account_tokens_revoke_title(),
              description: m.auth_account_tokens_revoke_desc(),
              confirmLabel: m.auth_account_tokens_revoke(),
            })}
        pending={revoke.isPending}
        onConfirm={() => revoking.target && revoke.mutate({ path: { id: revoking.target.id } })}
      />
    </>
  )
}
