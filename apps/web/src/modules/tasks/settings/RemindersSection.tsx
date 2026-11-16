import type { CaldavConnectionOut } from '@semestra/api-client'
import { caldavConnectionSetupLink } from '@semestra/api-client'
import {
  caldavConnectionCreateMutation,
  caldavConnectionDeleteMutation,
  caldavConnectionListOptions,
  caldavConnectionListQueryKey,
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
  QrCode,
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
import { useCopy } from '@/hooks/use-copy'
import { useDialogTarget } from '@/lib/dialog-target'
import { toastError } from '@/lib/errors'
import { formatDate, formatTimeAgo } from '@/lib/format'
import { m } from '@/paraglide/messages'
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

const DEVICE: Record<
  NonNullable<Device['client']> | 'waiting',
  { icon: LucideIcon; name: () => string }
> = {
  ios: { icon: Smartphone, name: m.tasks_reminders_device_ios },
  macos: { icon: Laptop, name: m.tasks_reminders_device_macos },
  other: { icon: MonitorSmartphone, name: m.tasks_reminders_device_other },
  waiting: { icon: Hourglass, name: m.tasks_reminders_device_waiting },
}

type RowActions = { setUp: (device: Device) => void; disconnect: (device: Device) => void }
const RowActionsContext = createContext<RowActions>({ setUp: () => {}, disconnect: () => {} })

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
      <DropdownMenuItem onClick={() => actions.setUp(device)}>
        <QrCode aria-hidden />
        {m.tasks_reminders_set_up()}
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

/**
 * Apple Reminders (M05 §11): devices that show and edit this Program's to-do lists over CalDAV.
 * Shown only when the server offers it (self-hosting with `SEMESTRA_CALDAV`).
 */
export default function RemindersSection({ scope }: SettingsSectionProps) {
  const programId = scope?.programId ?? ''
  const queryClient = useQueryClient()
  const state = useQuery(caldavConnectionListOptions({ path: { program_id: programId } }))
  const setUp = useDialogTarget<Device>()
  const disconnecting = useDialogTarget<Device>()
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: caldavConnectionListQueryKey({ path: { program_id: programId } }),
    })
  const create = useMutation({
    ...caldavConnectionCreateMutation(),
    onSuccess: (device) => {
      setUp.show(device)
      void refresh()
    },
    onError: toastError,
  })
  const remove = useMutation({
    ...caldavConnectionDeleteMutation(),
    onSuccess: () => {
      disconnecting.close()
      void refresh()
    },
    onError: (err) => (disconnecting.close(), toastError(err)),
  })
  if (state.data && !state.data.available) return null
  const connect = () => create.mutate({ path: { program_id: programId } })
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
          <RowActionsContext value={{ setUp: setUp.show, disconnect: disconnecting.show }}>
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
    </>
  )
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
  device: Device | null
  server: string
  username: string
}) {
  // The link is good for 15 minutes; a new one is made each time the dialog opens.
  const link = useQuery({
    queryKey: ['caldav-setup-link', device?.id],
    queryFn: async () =>
      (
        await caldavConnectionSetupLink({
          path: { connection_id: device?.id ?? '' },
          throwOnError: true,
        })
      ).data,
    enabled: props.open && device !== null,
    staleTime: 10 * 60_000,
    gcTime: 0,
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
