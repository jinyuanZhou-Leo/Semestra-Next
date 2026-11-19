import { accountSessionRevoke } from '@semestra/api-client'
import {
  accountSessionListOptions,
  accountSessionListQueryKey,
  accountSessionRevokeOthersMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { LogOut, Monitor, Smartphone } from 'lucide-react'
import { createContext, use, useState } from 'react'
import type { SessionOut } from '@semestra/api-client'
import { ActionRow, RowMenu, SettingsTable, settingsTableFeatures } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { deviceLabel } from '@/lib/device'
import { useDialogTarget } from '@/lib/dialog-target'
import { toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { SignOutDialog } from '../components/SignOutDialog'
import { Badge } from '@/ui/badge'
import { DropdownMenuItem } from '@/ui/dropdown-menu'

/**
 * One row per device: every sign-in starts a session, and a browser that lost its cookie (a
 * private window, cleared site data) leaves the old one behind until it expires. Sessions of the
 * same kind, browser, system and network read as the same device, so they are one row, and
 * signing that device out ends all of them.
 */
type Device = SessionOut & { sessionIds: string[] }

function deviceName(session: SessionOut): string {
  return deviceLabel(session.user_agent) ?? m.auth_account_sessions_unknown_device()
}

/** The list comes most recently used first, so each device shows its latest session. */
function toDevices(sessions: SessionOut[]): Device[] {
  const byKey = new Map<string, Device>()
  for (const s of sessions) {
    const key = [s.kind, deviceName(s), s.ip ?? ''].join('\u0000')
    const device = byKey.get(key)
    if (device) {
      device.sessionIds.push(s.id)
      device.current ||= s.current
    } else byKey.set(key, { ...s, sessionIds: [s.id] })
  }
  return [...byKey.values()]
}

const RevokeContext = createContext<(device: Device) => void>(() => {})

type CellProps = CellContext<typeof settingsTableFeatures, Device>

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

const column = createColumnHelper<typeof settingsTableFeatures, Device>()
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

type Target = { kind: 'device'; ids: string[] } | { kind: 'others' }

export function SessionsSection() {
  const queryClient = useQueryClient()
  // The other sessions of this browser's own row, ended along with signing out here.
  const [signingOut, setSigningOut] = useState<string[] | null>(null)
  const sessions = useQuery(accountSessionListOptions())
  const revoking = useDialogTarget<Target>()

  const done = () => {
    revoking.close()
    void queryClient.invalidateQueries({ queryKey: accountSessionListQueryKey() })
  }
  const revokeAll = (ids: string[]) =>
    Promise.all(
      ids.map((id) => accountSessionRevoke({ path: { session_id: id }, throwOnError: true })),
    )
  const revokeDevice = useMutation({
    mutationFn: revokeAll,
    onSuccess: done,
    onError: (err) => (revoking.close(), toastError(err)),
  })
  const revokeOthers = useMutation({
    ...accountSessionRevokeOthersMutation(),
    onSuccess: done,
    onError: (err) => (revoking.close(), toastError(err)),
  })

  return (
    <>
      <AsyncBoundary query={sessions}>
        {({ items }) => {
          const devices = toDevices(items)
          const currentId = items.find((s) => s.current)?.id
          return (
            <RevokeContext
              value={(device) =>
                // Signing out the device we are using must clear the cookies and leave the page
                // instead of refetching into a 401.
                device.current
                  ? setSigningOut(device.sessionIds.filter((id) => id !== currentId))
                  : revoking.show({ kind: 'device', ids: device.sessionIds })
              }
            >
              <SettingsTable
                label={m.auth_account_sessions_title()}
                data={devices}
                columns={columns}
                getRowId={(device) => device.id}
                columnClassName={COLUMN_CLASS}
                footer={
                  devices.some((d) => !d.current) ? (
                    <ActionRow destructive onClick={() => revoking.show({ kind: 'others' })}>
                      {m.auth_account_sessions_revoke_others()}
                    </ActionRow>
                  ) : undefined
                }
              />
            </RevokeContext>
          )
        }}
      </AsyncBoundary>
      <SignOutDialog
        open={signingOut !== null}
        onOpenChange={(open) => !open && setSigningOut(null)}
        before={signingOut?.length ? () => revokeAll(signingOut) : undefined}
      />
      <ConfirmDialog
        {...revoking.props}
        title={
          revoking.target?.kind === 'others'
            ? m.auth_account_sessions_revoke_others_title()
            : m.auth_account_sessions_revoke()
        }
        description={
          revoking.target?.kind === 'others' ? m.auth_account_sessions_revoke_others_desc() : null
        }
        confirmLabel={m.auth_account_sessions_revoke()}
        pending={revokeDevice.isPending || revokeOthers.isPending}
        onConfirm={() => {
          if (revoking.target?.kind === 'device') revokeDevice.mutate(revoking.target.ids)
          else if (revoking.target?.kind === 'others') revokeOthers.mutate({})
        }}
      />
    </>
  )
}
