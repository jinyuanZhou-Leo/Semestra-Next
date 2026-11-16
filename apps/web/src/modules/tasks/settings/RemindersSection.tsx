import type { CaldavConnectionOut, CaldavNewConnection } from '@semestra/api-client'
import { caldavConnectionSetupLink } from '@semestra/api-client'
import {
  caldavConnectionCreateMutation,
  caldavConnectionDeleteMutation,
  caldavConnectionListOptions,
  caldavConnectionListQueryKey,
  caldavConnectionResetMutation,
  settingsValueGetQueryKey,
  settingsValueUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import {
  Check,
  ChevronRight,
  Copy,
  Hourglass,
  Laptop,
  type LucideIcon,
  MonitorSmartphone,
  Plus,
  RotateCcw,
  Smartphone,
  Unplug,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { createContext, use } from 'react'
import type { SettingsSectionProps } from '@/app/extensions'
import { RowMenu, SectionAction, SettingsTable, settingsTableFeatures } from '@/app/settings'
import { SettingRow, SettingsGroup, SettingsNote } from '@/app/settings/rows'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useUiPref } from '@/app/ui-pref'
import { useCopy } from '@/hooks/use-copy'
import { useDialogTarget } from '@/lib/dialog-target'
import { toastError } from '@/lib/errors'
import { formatDate, formatTimeAgo } from '@/lib/format'
import { m } from '@/paraglide/messages'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog'
import { Button } from '@/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/ui/input-group'
import { Skeleton } from '@/ui/skeleton'

type Device = CaldavConnectionOut
type NewDevice = CaldavNewConnection

const DEVICE: Record<
  NonNullable<Device['client']> | 'waiting',
  { icon: LucideIcon; name: () => string }
> = {
  ios: { icon: Smartphone, name: m.tasks_reminders_device_ios },
  macos: { icon: Laptop, name: m.tasks_reminders_device_macos },
  other: { icon: MonitorSmartphone, name: m.tasks_reminders_device_other },
  waiting: { icon: Hourglass, name: m.tasks_reminders_device_waiting },
}

type RowActions = { setUpAgain: (device: Device) => void; disconnect: (device: Device) => void }
const RowActionsContext = createContext<RowActions>({
  setUpAgain: () => {},
  disconnect: () => {},
})

type CellProps = CellContext<typeof settingsTableFeatures, Device>

function DeviceCell({ row }: CellProps) {
  const d = row.original
  const kind = DEVICE[d.client ?? 'waiting']
  const Icon = kind.icon
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="truncate font-medium">{kind.name()}</div>
        <div className="truncate text-xs text-muted-foreground">
          {d.last_seen_at
            ? m.tasks_reminders_synced({ time: formatTimeAgo(d.last_seen_at) })
            : m.tasks_reminders_added({ date: formatDate(d.created_at) })}
        </div>
      </div>
    </div>
  )
}

function ActionsCell({ row }: CellProps) {
  const actions = use(RowActionsContext)
  const device = row.original
  const name = DEVICE[device.client ?? 'waiting'].name()
  return (
    <RowMenu label={m.tasks_reminders_actions({ name })}>
      <DropdownMenuItem onClick={() => actions.setUpAgain(device)}>
        <RotateCcw aria-hidden />
        {m.tasks_reminders_set_up_again()}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => actions.disconnect(device)}>
        <Unplug aria-hidden />
        {m.tasks_reminders_disconnect()}
      </DropdownMenuItem>
    </RowMenu>
  )
}

const column = createColumnHelper<typeof settingsTableFeatures, Device>()
const columns = column.columns([
  column.display({ id: 'device', header: () => m.tasks_reminders_device(), cell: DeviceCell }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">{m.common_actions()}</span>,
    cell: ActionsCell,
  }),
])
const COLUMN_CLASS: Record<string, string> = { device: 'w-full max-w-0', actions: 'w-10' }

const NOTIFICATIONS = {
  path: { namespace: 'notifications' },
  query: { scope_type: 'account' },
} as const

/**
 * Apple Reminders (M05 §11): devices that show and edit this Program's to-do lists over CalDAV.
 * Shown only when the server offers it (self-hosting with `SEMESTRA_CALDAV`). A device's
 * password is shown once, when it is connected or set up again; the server keeps only a hash.
 */
export default function RemindersSection({ scope }: SettingsSectionProps) {
  const programId = scope?.programId ?? ''
  const queryClient = useQueryClient()
  const state = useQuery(caldavConnectionListOptions({ path: { program_id: programId } }))
  const setUp = useDialogTarget<NewDevice>()
  const resetting = useDialogTarget<Device>()
  const disconnecting = useDialogTarget<Device>()
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: caldavConnectionListQueryKey({ path: { program_id: programId } }),
    })
  const showNew = (device: NewDevice) => {
    resetting.close()
    setUp.show(device)
    void refresh()
  }
  const create = useMutation({
    ...caldavConnectionCreateMutation(),
    onSuccess: showNew,
    onError: toastError,
  })
  const reset = useMutation({
    ...caldavConnectionResetMutation(),
    onSuccess: showNew,
    onError: (err) => (resetting.close(), toastError(err)),
  })
  const remove = useMutation({
    ...caldavConnectionDeleteMutation(),
    onSuccess: () => {
      disconnecting.close()
      void refresh()
    },
    onError: (err) => (disconnecting.close(), toastError(err)),
  })
  const push = usePushQuestion(
    // Once a device has really synced, and not over the setup dialog.
    Boolean(state.data?.task_notifications) &&
      Boolean(state.data?.items.some((d) => d.client !== null)) &&
      setUp.target === null,
  )
  if (state.data && !state.data.available) return null
  const connect = () => create.mutate({ path: { program_id: programId } })
  const resetNow = (device: Device) => reset.mutate({ path: { connection_id: device.id } })
  // A device that never synced has nothing to lose; one in use stops syncing until set up again.
  const setUpAgain = (device: Device) =>
    device.client === null ? resetNow(device) : resetting.show(device)
  const addButton = (
    <Button size="sm" disabled={create.isPending} onClick={connect}>
      <Plus aria-hidden />
      {m.tasks_reminders_connect()}
    </Button>
  )
  return (
    <>
      <SectionAction>{state.data?.items.length ? addButton : null}</SectionAction>
      <AsyncBoundary
        query={state}
        isEmpty={(s) => s.items.length === 0}
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Smartphone aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.tasks_reminders_empty()}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>{addButton}</EmptyContent>
          </Empty>
        }
      >
        {(s) => (
          <RowActionsContext value={{ setUpAgain, disconnect: disconnecting.show }}>
            <SettingsTable
              label={m.tasks_reminders_title()}
              data={s.items}
              columns={columns}
              getRowId={(d) => d.id}
              columnClassName={COLUMN_CLASS}
            />
          </RowActionsContext>
        )}
      </AsyncBoundary>
      <SetUpDialog
        {...setUp.props}
        device={setUp.target}
        server={state.data?.server_url ?? ''}
        username={state.data?.username ?? ''}
      />
      <ConfirmDialog
        {...resetting.props}
        title={m.tasks_reminders_set_up_again_title()}
        description={m.tasks_reminders_set_up_again_desc()}
        confirmLabel={m.tasks_reminders_set_up_again()}
        pending={reset.isPending}
        onConfirm={() => resetting.target && resetNow(resetting.target)}
      />
      <ConfirmDialog
        {...disconnecting.props}
        title={m.tasks_reminders_disconnect_title()}
        description={m.tasks_reminders_disconnect_desc()}
        confirmLabel={m.tasks_reminders_disconnect()}
        pending={remove.isPending}
        onConfirm={() =>
          disconnecting.target &&
          remove.mutate({ path: { connection_id: disconnecting.target.id } })
        }
      />
      <AlertDialog open={push.open} onOpenChange={(open) => !open && push.keep()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{m.tasks_reminders_push_title()}</AlertDialogTitle>
            <AlertDialogDescription>{m.tasks_reminders_push_description()}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{m.tasks_reminders_push_keep()}</AlertDialogCancel>
            <AlertDialogAction onClick={push.turnOff}>
              {m.tasks_reminders_push_off()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * Asks once whether to stop Semestra's own task notifications: Reminders alerts at the due time
 * too, so with both on each task would be announced twice. `relevant` says a device has synced
 * and the user gets those notifications. The setting is the account's, for every Program.
 */
function usePushQuestion(relevant: boolean) {
  const queryClient = useQueryClient()
  const [asked, setAsked, loaded] = useUiPref('tasks.reminders-push-asked', false)
  const update = useMutation({
    ...settingsValueUpdateMutation(),
    onSuccess: (result) => {
      queryClient.setQueryData(settingsValueGetQueryKey(NOTIFICATIONS), result)
      void queryClient.invalidateQueries({ queryKey: [{ _id: 'caldavConnectionList' }] })
    },
    onError: toastError,
  })
  return {
    open: relevant && loaded && !asked,
    keep: () => setAsked(true),
    turnOff: () => {
      setAsked(true)
      update.mutate({
        path: NOTIFICATIONS.path,
        body: { ...NOTIFICATIONS.query, values: { task_reminder: 'off' } },
      })
    },
  }
}

/** How to add the account on a device: scan, download, or type it in. */
function SetUpDialog({
  device,
  server,
  username,
  ...props
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenChangeComplete: (open: boolean) => void
  device: NewDevice | null
  server: string
  username: string
}) {
  // The link is good for 15 minutes; a new one is fetched a minute before it runs out, so the
  // code on screen always works. It needs the password, which only this dialog has.
  const link = useQuery({
    queryKey: ['caldav-setup-link', device?.id],
    queryFn: async () =>
      (
        await caldavConnectionSetupLink({
          path: { connection_id: device?.id ?? '' },
          body: { password: device?.password ?? '' },
          throwOnError: true,
        })
      ).data,
    initialData: device?.setup,
    enabled: props.open && device !== null,
    staleTime: Infinity,
    gcTime: 0,
    refetchInterval: (query) => {
      const expires = query.state.data ? new Date(query.state.data.expires_at).getTime() : 0
      // Timers longer than about 24 days fire at once, so stay within the link's life.
      return query.state.data
        ? Math.min(Math.max(expires - Date.now() - 60_000, 5_000), 15 * 60_000)
        : false
    },
  })
  return (
    <Dialog {...props}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{m.tasks_reminders_setup_title()}</DialogTitle>
          <DialogDescription>{m.tasks_reminders_setup_description()}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-5">
          <div className="grid size-36 shrink-0 place-items-center rounded-xl border bg-white p-2">
            {link.data ? (
              <QRCodeSVG
                value={link.data.url}
                size={128}
                title={m.tasks_reminders_qr_label()}
                className="size-full"
              />
            ) : (
              <Skeleton className="size-full" />
            )}
          </div>
          <div className="space-y-3 text-sm">
            <p>{m.tasks_reminders_scan()}</p>
            <Button
              size="sm"
              variant="outline"
              disabled={!link.data}
              nativeButton={false}
              // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the children label it
              render={<a href={link.data?.url} download="semestra.mobileconfig" />}
            >
              {m.tasks_reminders_download()}
            </Button>
          </div>
        </div>
        <Collapsible>
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="group/trigger -ml-2 justify-start font-normal aria-expanded:bg-transparent"
              />
            }
          >
            <ChevronRight
              aria-hidden
              className="transition-transform group-aria-expanded/trigger:rotate-90"
            />
            {m.tasks_reminders_manual()}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            <SettingsGroup>
              <CopyRow label={m.tasks_reminders_server()} value={server} />
              <CopyRow label={m.tasks_reminders_username()} value={username} />
              <CopyRow label={m.tasks_reminders_password()} value={device?.password ?? ''} />
            </SettingsGroup>
            <SettingsNote>{m.tasks_reminders_manual_hint()}</SettingsNote>
          </CollapsibleContent>
        </Collapsible>
        <DialogFooter>
          <Button onClick={() => props.onOpenChange(false)}>{m.tasks_reminders_done()}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const { copied, copy } = useCopy()
  return (
    <SettingRow label={label} size="sm">
      {(labelId) => (
        <InputGroup className="w-60">
          <InputGroupInput
            readOnly
            value={value}
            aria-labelledby={labelId}
            onFocus={(e) => e.target.select()}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={copied ? m.common_copied() : m.common_copy()}
              onClick={() => copy(value)}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      )}
    </SettingRow>
  )
}
