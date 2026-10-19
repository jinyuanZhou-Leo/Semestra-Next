import type { Provider } from '@semestra/api-client'
import {
  aiProviderDeleteMutation,
  aiProviderListOptions,
  aiProviderTestMutation,
  aiProviderUpdateMutation,
} from '@semestra/api-client/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Pencil, PlugZap, Plus, Power, PowerOff, Trash2 } from 'lucide-react'
import { createContext, use, useId, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { ActionRow, RowMenu, SettingsTable, settingsTableFeatures } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { errorMessage, toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'
import { Spinner } from '@/ui/spinner'
import { KIND_INFO, type Capability } from '../labels'
import { invalidateAi } from '../queries'
import { CapabilityChecks, ProviderForm } from './ProviderForm'

function StatusBadge({ provider }: { provider: Provider }) {
  if (!provider.enabled) return <Badge variant="outline">{m.ai_provider_status_off()}</Badge>
  if (provider.last_error_code) {
    return <Badge variant="destructive">{m.ai_provider_status_error()}</Badge>
  }
  return <Badge variant="secondary">{m.ai_provider_status_ok()}</Badge>
}

function EditProviderDialog({
  provider,
  onClose,
}: {
  provider: Provider | null
  onClose: () => void
}) {
  return (
    <Dialog open={provider !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.ai_provider_edit_title()}</DialogTitle>
          <DialogDescription>{m.ai_provider_key_note()}</DialogDescription>
        </DialogHeader>
        {provider ? (
          <EditProviderForm key={provider.id} provider={provider} onDone={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function EditProviderForm({ provider, onDone }: { provider: Provider; onDone: () => void }) {
  const queryClient = useQueryClient()
  const id = useId()
  const info = KIND_INFO[provider.kind]
  const [name, setName] = useState(provider.display_name)
  const [baseUrl, setBaseUrl] = useState(provider.base_url ?? '')
  const [apiKey, setApiKey] = useState('')
  const [capabilities, setCapabilities] = useState<Capability[]>(provider.capabilities)
  const update = useMutation(aiProviderUpdateMutation())

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const body: Record<string, unknown> = {}
    if (name.trim() && name.trim() !== provider.display_name) body.display_name = name.trim()
    if (info.needsBaseUrl && baseUrl.trim() !== (provider.base_url ?? ''))
      body.base_url = baseUrl.trim()
    if (apiKey.trim()) body.api_key = apiKey.trim()
    if (provider.capabilities_editable) body.capabilities = capabilities
    update.mutate(
      { path: { id: provider.id }, body },
      {
        onSuccess: async () => {
          await invalidateAi(queryClient)
          onDone()
        },
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate>
      <fieldset disabled={update.isPending}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>{m.ai_provider_name()}</FieldLabel>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {info.needsBaseUrl ? (
            <Field>
              <FieldLabel htmlFor={`${id}-base-url`}>{m.ai_provider_base_url()}</FieldLabel>
              <Input
                id={`${id}-base-url`}
                value={baseUrl}
                spellCheck={false}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor={`${id}-key`}>{m.ai_provider_new_key()}</FieldLabel>
            <Input
              id={`${id}-key`}
              type="password"
              autoComplete="off"
              placeholder={provider.key_hint ?? undefined}
              aria-describedby={`${id}-key-hint`}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <FieldDescription id={`${id}-key-hint`}>
              {m.ai_provider_new_key_hint()}
            </FieldDescription>
          </Field>
          {provider.capabilities_editable ? (
            <CapabilityChecks value={capabilities} onChange={setCapabilities} />
          ) : null}
          <FieldError>{update.error ? errorMessage(update.error) : null}</FieldError>
          <DialogFooter>
            <Button type="submit">
              {update.isPending ? m.ai_provider_checking() : m.common_save()}
            </Button>
          </DialogFooter>
        </FieldGroup>
      </fieldset>
    </form>
  )
}

type RowHandlers = {
  testingId: string | null
  togglingId: string | null
  onEdit: (provider: Provider) => void
  onTest: (provider: Provider) => void
  onToggle: (provider: Provider) => void
  onDelete: (provider: Provider) => void
}

const RowContext = createContext<RowHandlers | null>(null)

function useRowHandlers(): RowHandlers {
  const handlers = use(RowContext)
  if (!handlers) throw new Error('Provider cells render inside the providers table')
  return handlers
}

type CellProps = CellContext<typeof settingsTableFeatures, Provider>

function NameCell({ row }: CellProps) {
  const provider = row.original
  const Icon = KIND_INFO[provider.kind].icon
  const details = [provider.key_hint, provider.base_url].filter(Boolean)
  return (
    // A switched-off provider is dimmed so the ones in use stand out.
    <div className={cn('flex min-w-0 items-center gap-3', !provider.enabled && 'opacity-60')}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
        <Icon aria-hidden className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0">
        <div className="truncate font-medium">{provider.display_name}</div>
        {details.length ? (
          <div className="truncate text-xs text-muted-foreground">{details.join(' · ')}</div>
        ) : null}
      </div>
    </div>
  )
}

function StatusCell({ row }: CellProps) {
  const { testingId } = useRowHandlers()
  const provider = row.original
  const error =
    provider.enabled && provider.last_error_code
      ? errorMessage({ error: { code: provider.last_error_code, params: {} } })
      : null
  // Two lines in every state (the badge, or a spinner while testing, over the error or the last
  // check), so testing a connection never changes the row's height.
  return (
    <div className="flex flex-col items-start gap-0.5">
      <div className="flex h-5 items-center">
        {testingId === provider.id ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner aria-hidden className="size-3.5" />
            {m.ai_provider_checking()}
          </span>
        ) : (
          <StatusBadge provider={provider} />
        )}
      </div>
      {error ? (
        <span className="line-clamp-2 max-w-64 text-xs whitespace-normal text-destructive">
          {error}
        </span>
      ) : provider.last_checked_at ? (
        <span className="text-xs text-muted-foreground">
          {m.ai_provider_checked_at({ time: formatDateTime(provider.last_checked_at) })}
        </span>
      ) : null}
    </div>
  )
}

function ActionsCell({ row }: CellProps) {
  const { testingId, togglingId, onEdit, onTest, onToggle, onDelete } = useRowHandlers()
  const provider = row.original
  return (
    <RowMenu label={m.ai_provider_actions({ name: provider.display_name })}>
      <DropdownMenuItem onClick={() => onEdit(provider)}>
        <Pencil aria-hidden />
        {m.common_edit()}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={testingId === provider.id} onClick={() => onTest(provider)}>
        <PlugZap aria-hidden />
        {m.ai_provider_test()}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={togglingId === provider.id} onClick={() => onToggle(provider)}>
        {provider.enabled ? <PowerOff aria-hidden /> : <Power aria-hidden />}
        {provider.enabled ? m.ai_provider_disable() : m.ai_provider_enable()}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => onDelete(provider)}>
        <Trash2 aria-hidden />
        {m.common_delete()}
      </DropdownMenuItem>
    </RowMenu>
  )
}

const column = createColumnHelper<typeof settingsTableFeatures, Provider>()
const columns = column.columns([
  column.accessor((p) => p.display_name, {
    id: 'name',
    header: () => m.ai_provider_name(),
    cell: NameCell,
  }),
  column.accessor((p) => p.kind, {
    id: 'kind',
    header: () => m.ai_provider_type(),
    cell: ({ row }) => (
      <span className={cn('text-muted-foreground', !row.original.enabled && 'opacity-60')}>
        {KIND_INFO[row.original.kind].name()}
      </span>
    ),
  }),
  column.display({ id: 'status', header: () => m.ai_provider_status(), cell: StatusCell }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">{m.common_actions()}</span>,
    cell: ActionsCell,
  }),
])

const COLUMN_CLASS: Record<string, string> = {
  name: 'w-full max-w-0',
  kind: 'hidden whitespace-nowrap sm:table-cell',
  status: 'whitespace-nowrap',
  actions: 'w-10',
}

/**
 * Account settings → AI → providers (M06 §7): the user's keys as a table of name, type and
 * state; edit, test, switch off and delete sit in each row's "⋯" menu.
 */
export function ProvidersSection() {
  const queryClient = useQueryClient()
  const providers = useQuery(aiProviderListOptions())
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Provider | null>(null)
  // The last provider asked about stays set so the dialog keeps its text while it closes.
  const [deleting, setDeleting] = useState<Provider | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const remove = useMutation({
    ...aiProviderDeleteMutation(),
    onSuccess: async () => {
      setConfirmingDelete(false)
      await invalidateAi(queryClient)
    },
    onError: (err) => {
      setConfirmingDelete(false)
      toastError(err)
    },
  })
  const test = useMutation({
    ...aiProviderTestMutation(),
    onSuccess: async (check) => {
      await invalidateAi(queryClient)
      if (check.ok) toast.success(m.ai_provider_test_ok())
      else toast.error(errorMessage({ error: { code: check.error_code, params: {} } }))
    },
    onError: toastError,
  })
  const toggle = useMutation({
    ...aiProviderUpdateMutation(),
    onSuccess: () => invalidateAi(queryClient),
    onError: toastError,
  })
  const handlers: RowHandlers = {
    testingId: test.isPending ? (test.variables?.path.id ?? null) : null,
    togglingId: toggle.isPending ? (toggle.variables?.path.id ?? null) : null,
    onEdit: setEditing,
    onTest: (provider) => test.mutate({ path: { id: provider.id } }),
    onToggle: (provider) =>
      toggle.mutate({ path: { id: provider.id }, body: { enabled: !provider.enabled } }),
    onDelete: (provider) => {
      setDeleting(provider)
      setConfirmingDelete(true)
    },
  }

  return (
    <>
      <AsyncBoundary
        query={providers}
        isEmpty={(data) => data.items.length === 0}
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <KeyRound aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.ai_providers_empty()}</EmptyTitle>
              <EmptyDescription>{m.ai_providers_empty_description()}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                {m.ai_provider_add()}
              </Button>
            </EmptyContent>
          </Empty>
        }
      >
        {(data) => (
          <RowContext value={handlers}>
            <SettingsTable
              label={m.ai_settings_providers()}
              data={data.items}
              columns={columns}
              getRowId={(provider) => provider.id}
              columnClassName={COLUMN_CLASS}
              footer={
                <ActionRow icon={Plus} onClick={() => setAdding(true)}>
                  {m.ai_provider_add()}
                </ActionRow>
              }
            />
          </RowContext>
        )}
      </AsyncBoundary>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m.ai_provider_add()}</DialogTitle>
            <DialogDescription>{m.ai_provider_key_note()}</DialogDescription>
          </DialogHeader>
          <ProviderForm onSaved={() => setAdding(false)} />
        </DialogContent>
      </Dialog>
      <EditProviderDialog provider={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={m.ai_provider_delete_title()}
        description={m.ai_provider_delete_desc({ name: deleting?.display_name ?? '' })}
        confirmLabel={m.common_delete()}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ path: { id: deleting.id } })}
      />
    </>
  )
}
