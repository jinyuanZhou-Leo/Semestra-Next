import {
  accountSessionsListOptions,
  accountSessionsListQueryKey,
  accountSessionsRevokeMutation,
  accountSessionsRevokeOthersMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { LogOut, Monitor, Smartphone } from 'lucide-react'
import { createContext, use, useState } from 'react'
import type { SessionOut } from '@semestra/api-client'
import { ActionRow, RowMenu, SettingsTable, settingsTableFeatures } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { deviceLabel } from '@/lib/device'
import { errorMessage, toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { SignOutDialog } from '../components/SignOutDialog'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { FieldError } from '@/ui/field'
import { DropdownMenuItem } from '@/ui/dropdown-menu'

const RevokeContext = createContext<(session: SessionOut) => void>(() => {})

type CellProps = CellContext<typeof settingsTableFeatures, SessionOut>

function deviceName(session: SessionOut): string {
  return deviceLabel(session.user_agent) ?? m.auth_account_sessions_unknown_device()
}

function DeviceCell({ row }: CellProps) {
  const s = row.original
  const Icon = s.kind === 'native' ? Smartphone : Monitor
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
        <Icon aria-hidden className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{deviceName(s)}</span>
          {s.current ? <Badge>{m.common_current()}</Badge> : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {[
            s.kind === 'native' ? m.auth_account_sessions_native() : m.auth_account_sessions_web(),
            s.ip,
            m.auth_account_sessions_last_active({ time: formatDateTime(s.last_used_at) }),
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
  const s = row.original
  return (
    <RowMenu label={m.auth_account_sessions_actions({ device: deviceName(s) })}>
      <DropdownMenuItem variant="destructive" onClick={() => onRevoke(s)}>
        <LogOut aria-hidden />
        {s.current ? m.auth_account_signout() : m.auth_account_sessions_revoke()}
      </DropdownMenuItem>
    </RowMenu>
  )
}

const column = createColumnHelper<typeof settingsTableFeatures, SessionOut>()
const columns = column.columns([
  column.display({
    id: 'device',
    header: () => m.auth_account_sessions_device(),
    cell: DeviceCell,
  }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">{m.common_actions()}</span>,
    cell: ActionsCell,
  }),
])

const COLUMN_CLASS: Record<string, string> = { device: 'w-full max-w-0', actions: 'w-10' }

type Target = { kind: 'one'; id: string } | { kind: 'others' }

export function SessionsSection() {
  const queryClient = useQueryClient()
  const [signingOut, setSigningOut] = useState(false)
  const sessions = useQuery(accountSessionsListOptions())
  const [target, setTarget] = useState<Target | null>(null)

  const done = () => {
    setTarget(null)
    void queryClient.invalidateQueries({ queryKey: accountSessionsListQueryKey() })
  }
  const revokeOne = useMutation({
    ...accountSessionsRevokeMutation(),
    onSuccess: done,
    onError: (err) => (setTarget(null), toastError(err)),
  })
  const revokeOthers = useMutation({
    ...accountSessionsRevokeOthersMutation(),
    onSuccess: done,
    onError: (err) => (setTarget(null), toastError(err)),
  })

  const items = sessions.data?.items ?? []
  const hasOthers = items.some((s) => !s.current)

  return (
    <>
      {sessions.isPending ? (
        <p className="text-sm text-muted-foreground">{m.common_loading()}</p>
      ) : sessions.isError ? (
        <div className="space-y-2">
          <FieldError>{errorMessage(sessions.error)}</FieldError>
          <Button variant="outline" size="sm" onClick={() => void sessions.refetch()}>
            {m.common_retry()}
          </Button>
        </div>
      ) : (
        <RevokeContext
          value={(session) =>
            // Revoking the session we are using is a sign-out: it must clear the cookies and
            // leave the page instead of refetching into a 401.
            session.current ? setSigningOut(true) : setTarget({ kind: 'one', id: session.id })
          }
        >
          <SettingsTable
            label={m.auth_account_sessions_title()}
            data={items}
            columns={columns}
            getRowId={(session) => session.id}
            columnClassName={COLUMN_CLASS}
            footer={
              hasOthers ? (
                <ActionRow destructive onClick={() => setTarget({ kind: 'others' })}>
                  {m.auth_account_sessions_revoke_others()}
                </ActionRow>
              ) : undefined
            }
          />
        </RevokeContext>
      )}
      <SignOutDialog open={signingOut} onOpenChange={setSigningOut} />
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={
          target?.kind === 'others'
            ? m.auth_account_sessions_revoke_others_title()
            : m.auth_account_sessions_revoke()
        }
        description={
          target?.kind === 'others' ? m.auth_account_sessions_revoke_others_desc() : null
        }
        confirmLabel={m.auth_account_sessions_revoke()}
        pending={revokeOne.isPending || revokeOthers.isPending}
        onConfirm={() => {
          if (target?.kind === 'one') revokeOne.mutate({ path: { session_id: target.id } })
          else if (target?.kind === 'others') revokeOthers.mutate({})
        }}
      />
    </>
  )
}
