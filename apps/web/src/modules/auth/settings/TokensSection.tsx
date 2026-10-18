import { client, type TokenCreated } from '@semestra/api-client'
import {
  accountTokensCreateMutation,
  accountTokensListOptions,
  accountTokensListQueryKey,
  accountTokensRevokeMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { AppDialogContent } from '@/components/AppDialogContent'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { TextField } from '@/components/TextField'
import { toastError } from '@/lib/errors'
import { formatDate, formatDateTime } from '@/lib/format'
import { focusOnMount } from '@/lib/focus'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Field, FieldLabel } from '@/ui/field'
import { NativeSelect, NativeSelectOption } from '@/ui/native-select'
import { Separator } from '@/ui/separator'
import { FormError } from '../components/FormError'
import { SettingsCard } from './SettingsCard'

/** Snippet for Claude Desktop and other MCP clients (remote server through `mcp-remote`). */
export function mcpConfig(token: string, apiOrigin: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        semestra: {
          command: 'npx',
          args: [
            '-y',
            'mcp-remote',
            `${apiOrigin.replace(/\/$/, '')}/mcp`,
            '--header',
            'Authorization: Bearer ${SEMESTRA_TOKEN}',
          ],
          env: { SEMESTRA_TOKEN: token },
        },
      },
    },
    null,
    2,
  )
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(m.common_copied())
  } catch {
    toast.error(m.common_copy())
  }
}

function CreateTokenDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (token: TokenCreated) => void
}) {
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'read' | 'write'>('read')
  const [days, setDays] = useState('')
  const create = useMutation(accountTokensCreateMutation())

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    create.mutate(
      {
        body: {
          name: name.trim(),
          scopes: scope === 'write' ? ['read', 'write'] : ['read'],
          expires_in_days: days ? Number(days) : null,
        },
      },
      {
        onSuccess: (token) => {
          setName('')
          setScope('read')
          setDays('')
          onCreated(token)
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!create.isPending) {
          if (!next) create.reset()
          onOpenChange(next)
        }
      }}
    >
      <AppDialogContent>
        <DialogHeader>
          <DialogTitle>{m.auth_account_tokens_create()}</DialogTitle>
          <DialogDescription>{m.auth_account_tokens_desc()}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <fieldset disabled={create.isPending} className="space-y-4">
            <TextField
              label={m.auth_account_tokens_name_label()}
              placeholder={m.auth_account_tokens_name_placeholder()}
              value={name}
              maxLength={60}
              ref={focusOnMount}
              onChange={(e) => setName(e.target.value)}
            />
            <Field>
              <FieldLabel htmlFor="token-scope">{m.auth_account_tokens_scope_label()}</FieldLabel>
              <NativeSelect
                id="token-scope"
                className="w-full"
                value={scope}
                onChange={(e) => setScope(e.target.value === 'write' ? 'write' : 'read')}
              >
                <NativeSelectOption value="read">
                  {m.auth_account_tokens_scope_read()}
                </NativeSelectOption>
                <NativeSelectOption value="write">
                  {m.auth_account_tokens_scope_write()}
                </NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="token-expiry">{m.auth_account_tokens_expiry_label()}</FieldLabel>
              <NativeSelect
                id="token-expiry"
                className="w-full"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              >
                <NativeSelectOption value="">
                  {m.auth_account_tokens_expiry_never()}
                </NativeSelectOption>
                {[30, 90, 365].map((d) => (
                  <NativeSelectOption key={d} value={d}>
                    {m.auth_account_tokens_expiry_days({ days: d })}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <FormError error={create.error} />
            <DialogFooter>
              <Button type="submit" disabled={!name.trim()}>
                {create.isPending ? m.common_saving() : m.auth_account_tokens_create()}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </AppDialogContent>
    </Dialog>
  )
}

function TokenCreatedDialog({
  token,
  onClose,
}: {
  token: TokenCreated | null
  onClose: () => void
}) {
  return (
    <Dialog open={token !== null} onOpenChange={(open) => !open && onClose()}>
      <AppDialogContent>
        <DialogHeader>
          <DialogTitle>{m.auth_account_tokens_created_title()}</DialogTitle>
          <DialogDescription>{m.auth_account_tokens_created_desc()}</DialogDescription>
        </DialogHeader>
        {token ? (
          <div className="space-y-3">
            <code
              className="block rounded-2xl bg-muted p-3 font-mono text-xs break-all select-all"
              data-testid="new-token"
            >
              {token.token}
            </code>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void copy(token.token)}>
                {m.auth_account_tokens_copy_token()}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copy(mcpConfig(token.token, client.getConfig().baseUrl ?? ''))}
              >
                {m.auth_account_tokens_copy_mcp()}
              </Button>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose}>{m.auth_account_tokens_done()}</Button>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  )
}

export function TokensSection() {
  const queryClient = useQueryClient()
  const tokens = useQuery(accountTokensListOptions())
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<TokenCreated | null>(null)
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: accountTokensListQueryKey() })
  const revoke = useMutation({
    ...accountTokensRevokeMutation(),
    onSuccess: () => {
      setRevoking(null)
      void refresh()
    },
    onError: (err) => (setRevoking(null), toastError(err)),
  })

  const items = tokens.data?.items ?? []

  return (
    <SettingsCard>
      {tokens.isPending ? (
        <p className="text-sm text-muted-foreground">{m.common_loading()}</p>
      ) : tokens.isError ? (
        <div className="space-y-2">
          <FormError error={tokens.error} />
          <Button variant="outline" size="sm" onClick={() => void tokens.refetch()}>
            {m.common_retry()}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{m.auth_account_tokens_empty()}</p>
      ) : (
        <ul>
          {items.map((t, i) => (
            <li key={t.id}>
              {i > 0 ? <Separator className="my-3" /> : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{t.name}</span>
                    <Badge variant="secondary">
                      {t.scopes.includes('write')
                        ? m.auth_account_tokens_scope_write()
                        : m.auth_account_tokens_scope_read()}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
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
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={m.auth_account_tokens_revoke_aria({ name: t.name })}
                  onClick={() => setRevoking({ id: t.id, name: t.name })}
                >
                  {m.auth_account_tokens_revoke()}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" onClick={() => setCreating(true)}>
        {m.auth_account_tokens_create()}
      </Button>
      <CreateTokenDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(token) => {
          setCreating(false)
          setCreated(token)
          void refresh()
        }}
      />
      <TokenCreatedDialog token={created} onClose={() => setCreated(null)} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={m.auth_account_tokens_revoke_title()}
        description={m.auth_account_tokens_revoke_desc()}
        confirmLabel={m.auth_account_tokens_revoke()}
        pending={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate({ path: { id: revoking.id } })}
      />
    </SettingsCard>
  )
}
