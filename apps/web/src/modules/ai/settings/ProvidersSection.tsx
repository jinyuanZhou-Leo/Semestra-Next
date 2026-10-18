import type { Provider } from '@semestra/api-client'
import {
  aiProviderDeleteMutation,
  aiProviderListOptions,
  aiProviderTestMutation,
  aiProviderUpdateMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { TextField } from '@/components/TextField'
import { errorMessage, toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Card, CardContent } from '@/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { Switch } from '@/ui/switch'
import { CAPABILITY_TITLES, KIND_INFO, type Capability } from '../labels'
import { invalidateAi } from '../queries'
import { CapabilityChecks, ProviderForm } from './ProviderForm'

function StatusBadge({ provider }: { provider: Provider }) {
  if (!provider.enabled) return <Badge variant="outline">{m.ai_provider_status_off()}</Badge>
  if (provider.last_error_code) {
    return (
      <Badge variant="destructive">
        {errorMessage({ error: { code: provider.last_error_code, params: {} } })}
      </Badge>
    )
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
      <DialogContent closeLabel={m.common_close()}>
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
      <fieldset disabled={update.isPending} className="space-y-4">
        <TextField
          label={m.ai_provider_name()}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
        {info.needsBaseUrl ? (
          <TextField
            label={m.ai_provider_base_url()}
            value={baseUrl}
            spellCheck={false}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        ) : null}
        <TextField
          label={m.ai_provider_new_key()}
          type="password"
          autoComplete="off"
          placeholder={provider.key_hint ?? undefined}
          hint={m.ai_provider_new_key_hint()}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        {provider.capabilities_editable ? (
          <CapabilityChecks value={capabilities} onChange={setCapabilities} />
        ) : null}
        {update.error ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(update.error)}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="submit">
            {update.isPending ? m.ai_provider_checking() : m.common_save()}
          </Button>
        </DialogFooter>
      </fieldset>
    </form>
  )
}

function ProviderRow({
  provider,
  onEdit,
  onDelete,
}: {
  provider: Provider
  onEdit: () => void
  onDelete: () => void
}) {
  const queryClient = useQueryClient()
  const info = KIND_INFO[provider.kind]
  const Icon = info.icon
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
  const details = [
    info.name(),
    provider.key_hint,
    provider.base_url,
    provider.last_checked_at
      ? m.ai_provider_checked_at({ time: formatDateTime(provider.last_checked_at) })
      : null,
  ].filter(Boolean)

  return (
    <li className="flex flex-wrap items-center gap-3 p-4">
      <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="truncate">{provider.display_name}</span>
          <StatusBadge provider={provider} />
        </div>
        <p className="truncate text-xs text-muted-foreground">{details.join(' · ')}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {provider.capabilities.map((c) => CAPABILITY_TITLES[c]()).join(' · ')}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Switch
          checked={provider.enabled}
          aria-label={m.ai_provider_enabled_aria({ name: provider.display_name })}
          disabled={toggle.isPending}
          onCheckedChange={(enabled) =>
            toggle.mutate({ path: { id: provider.id }, body: { enabled } })
          }
        />
        <Button
          variant="outline"
          size="sm"
          disabled={test.isPending}
          onClick={() => test.mutate({ path: { id: provider.id } })}
        >
          {test.isPending ? m.ai_provider_checking() : m.ai_provider_test()}
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit}>
          {m.common_edit()}
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label={m.ai_provider_delete_aria({ name: provider.display_name })}
          onClick={onDelete}
        >
          {m.common_delete()}
        </Button>
      </div>
    </li>
  )
}

/** Account settings → AI → providers (M06 §7): the user's keys, masked, with their state. */
export function ProvidersSection() {
  const queryClient = useQueryClient()
  const providers = useQuery(aiProviderListOptions())
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Provider | null>(null)
  const [deleting, setDeleting] = useState<Provider | null>(null)
  const remove = useMutation({
    ...aiProviderDeleteMutation(),
    onSuccess: async () => {
      setDeleting(null)
      await invalidateAi(queryClient)
    },
    onError: (err) => (setDeleting(null), toastError(err)),
  })

  return (
    <Card>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{m.ai_providers_intro()}</p>
        <AsyncBoundary
          query={providers}
          isEmpty={(data) => data.items.length === 0}
          empty={<p className="text-sm text-muted-foreground">{m.ai_providers_empty()}</p>}
        >
          {(data) => (
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {data.items.map((provider) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  onEdit={() => setEditing(provider)}
                  onDelete={() => setDeleting(provider)}
                />
              ))}
            </ul>
          )}
        </AsyncBoundary>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          {m.ai_provider_add()}
        </Button>
      </CardContent>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent closeLabel={m.common_close()}>
          <DialogHeader>
            <DialogTitle>{m.ai_provider_add()}</DialogTitle>
            <DialogDescription>{m.ai_provider_key_note()}</DialogDescription>
          </DialogHeader>
          <ProviderForm onSaved={() => setAdding(false)} />
        </DialogContent>
      </Dialog>
      <EditProviderDialog provider={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={m.ai_provider_delete_title()}
        description={m.ai_provider_delete_desc({ name: deleting?.display_name ?? '' })}
        confirmLabel={m.common_delete()}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate({ path: { id: deleting.id } })}
      />
    </Card>
  )
}
