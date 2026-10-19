import type { Connection } from '@semestra/api-client'
import {
  lmsConnectionDeleteMutation,
  lmsConnectionListOptions,
  lmsConnectionValidateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ActionRow, SettingsGroup } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { errorMessage, toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/ui/item'
import { useProviderUis } from '../providers'
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

function ConnectionRow({
  connection,
  onEdit,
  onDelete,
}: {
  connection: Connection
  onEdit: () => void
  onDelete: () => void
}) {
  const queryClient = useQueryClient()
  const ui = useProviderUis().get(connection.provider)
  const Logo = ui?.logo ?? Link2
  const check = useMutation({
    ...lmsConnectionValidateMutation(),
    onSuccess: async (result) => {
      await invalidateLms(queryClient)
      if (result.ok) toast.success(m.lms_connection_check_ok())
      else
        toast.error(
          errorMessage({ error: { code: result.error_code, params: result.error_params ?? {} } }),
        )
    },
    onError: toastError,
  })
  const baseUrl = connection.config.base_url
  const details = [
    ui?.label() ?? connection.provider,
    typeof baseUrl === 'string' ? baseUrl.replace(/^https?:\/\//, '') : null,
    connection.account_name,
    ...Object.values(connection.credentials_hint),
    connection.last_checked_at
      ? m.lms_connection_checked_at({ time: formatDateTime(connection.last_checked_at) })
      : null,
  ].filter(Boolean)
  const usage =
    connection.program_ids.length > 0
      ? m.lms_connection_usage({
          programs: connection.program_ids.length,
          courses: connection.link_count,
        })
      : m.lms_connection_unused()

  return (
    <Item>
      <ItemMedia variant="icon">
        <Logo aria-hidden className="size-5 text-muted-foreground" />
      </ItemMedia>
      <ItemContent className="min-w-0 basis-56">
        <ItemTitle>
          <span className="truncate">{connection.display_name}</span>
          <ConnectionStatus connection={connection} />
        </ItemTitle>
        <ItemDescription className="truncate">{details.join(' · ')}</ItemDescription>
        <ItemDescription>{usage}</ItemDescription>
      </ItemContent>
      <ItemActions className="shrink-0">
        <Button
          variant="outline"
          size="sm"
          disabled={check.isPending || !connection.has_credentials}
          onClick={() => check.mutate({ body: { connection_id: connection.id } })}
        >
          {check.isPending ? m.lms_connection_checking() : m.lms_connection_check()}
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit}>
          {m.common_edit()}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          aria-label={m.lms_connection_delete_aria({ name: connection.display_name })}
          onClick={onDelete}
        >
          {m.common_delete()}
        </Button>
      </ItemActions>
    </Item>
  )
}

/** Account settings → Integrations → LMS connections (M09 §7.1). Tokens are only shown masked. */
export function ConnectionsSection() {
  const queryClient = useQueryClient()
  const connections = useQuery(lmsConnectionListOptions())
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Connection | null>(null)
  const [deleting, setDeleting] = useState<Connection | null>(null)
  const remove = useMutation({
    ...lmsConnectionDeleteMutation(),
    onSuccess: async () => {
      setDeleting(null)
      await invalidateLms(queryClient)
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
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                {m.lms_connection_add()}
              </Button>
            </EmptyContent>
          </Empty>
        }
      >
        {(data) => (
          <SettingsGroup>
            {data.items.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                onEdit={() => setEditing(connection)}
                onDelete={() => setDeleting(connection)}
              />
            ))}
            <ActionRow icon={Plus} onClick={() => setAdding(true)}>
              {m.lms_connection_add()}
            </ActionRow>
          </SettingsGroup>
        )}
      </AsyncBoundary>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m.lms_connection_add()}</DialogTitle>
            <DialogDescription>{m.lms_connection_note()}</DialogDescription>
          </DialogHeader>
          {adding ? <ConnectionForm onSaved={() => setAdding(false)} /> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m.lms_connection_edit()}</DialogTitle>
            <DialogDescription>{m.lms_connection_note()}</DialogDescription>
          </DialogHeader>
          {editing ? (
            <ConnectionForm
              key={editing.id}
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
