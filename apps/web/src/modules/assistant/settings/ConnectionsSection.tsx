import type { TokenOut } from '@semestra/api-client'
import {
  accountTokenListOptions,
  accountTokenListQueryKey,
  accountTokenRevokeMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { Ban, KeyRound, Plus } from 'lucide-react'
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
import { DropdownMenuItem } from '@/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { AddConnectionDialog, ClientTile } from './AddConnectionDialog'
import { clientOfToken } from './mcp-clients'

const RevokeContext = createContext<(token: TokenOut) => void>(() => {})

type CellProps = CellContext<typeof settingsTableFeatures, TokenOut>

function NameCell({ row }: CellProps) {
  const t = row.original
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ClientTile client={clientOfToken(t.name)} />
      <div className="min-w-0">
        <div className="truncate font-medium">{t.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {[
            `${t.prefix}…`,
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
  const onRevoke = use(RevokeContext)
  return (
    <RowMenu label={m.auth_account_tokens_actions({ name: row.original.name })}>
      <DropdownMenuItem variant="destructive" onClick={() => onRevoke(row.original)}>
        <Ban aria-hidden />
        {m.auth_account_tokens_revoke()}
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
  name: 'w-full max-w-0',
  scope: 'whitespace-nowrap',
  actions: 'w-10',
}

/**
 * Connected clients and API tokens (M12 §5): one list, since every connection is an API token
 * named after its client, and one way to add either.
 */
export function ConnectionsSection() {
  // Clients run outside the browser: same-origin deployments need the page's origin.
  const url = new URL(apiUrl('/mcp'), window.location.origin).href
  const queryClient = useQueryClient()
  const tokens = useQuery(accountTokenListOptions())
  const [adding, setAdding] = useState(false)
  const revoking = useDialogTarget<{ id: string; name: string }>()

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
          <RevokeContext value={(t) => revoking.show({ id: t.id, name: t.name })}>
            <SectionAction>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                {m.assistant_mcp_add()}
              </Button>
            </SectionAction>
            <SettingsTable
              label={m.auth_account_tokens_title()}
              data={page.items}
              columns={columns}
              getRowId={(t) => t.id}
              columnClassName={COLUMN_CLASS}
            />
          </RevokeContext>
        )}
      </AsyncBoundary>
      <AddConnectionDialog open={adding} onOpenChange={setAdding} url={url} />
      <ConfirmDialog
        {...revoking.props}
        title={m.auth_account_tokens_revoke_title()}
        description={m.auth_account_tokens_revoke_desc()}
        confirmLabel={m.auth_account_tokens_revoke()}
        pending={revoke.isPending}
        onConfirm={() => revoking.target && revoke.mutate({ path: { id: revoking.target.id } })}
      />
    </>
  )
}
