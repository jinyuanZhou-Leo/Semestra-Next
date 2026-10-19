import { client, type TokenCreated } from '@semestra/api-client'
import {
  accountTokensCreateMutation,
  accountTokensListOptions,
  accountTokensListQueryKey,
  accountTokensRevokeMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { ActionRow, SettingsGroup } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { errorMessage, toastError } from '@/lib/errors'
import { formatDate, formatDateTime } from '@/lib/format'
import { focusOnMount } from '@/lib/focus'
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
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Field, FieldError, FieldLabel, FieldSet } from '@/ui/field'
import { Input } from '@/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/ui/item'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/select'

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
  const nameId = useId()
  const scopeId = useId()
  const expiryId = useId()
  const scopeItems = [
    { value: 'read', label: m.auth_account_tokens_scope_read() },
    { value: 'write', label: m.auth_account_tokens_scope_write() },
  ]
  const expiryItems = [
    { value: 'never', label: m.auth_account_tokens_expiry_never() },
    ...[30, 90, 365].map((d) => ({
      value: String(d),
      label: m.auth_account_tokens_expiry_days({ days: d }),
    })),
  ]
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'read' | 'write'>('read')
  const [days, setDays] = useState('never')
  const create = useMutation(accountTokensCreateMutation())

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    create.mutate(
      {
        body: {
          name: name.trim(),
          scopes: scope === 'write' ? ['read', 'write'] : ['read'],
          expires_in_days: days === 'never' ? null : Number(days),
        },
      },
      {
        onSuccess: (token) => {
          setName('')
          setScope('read')
          setDays('never')
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.auth_account_tokens_create()}</DialogTitle>
          <DialogDescription>{m.auth_account_tokens_desc()}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldSet disabled={create.isPending} className="gap-4">
            <Field>
              <FieldLabel htmlFor={nameId}>{m.auth_account_tokens_name_label()}</FieldLabel>
              <Input
                id={nameId}
                placeholder={m.auth_account_tokens_name_placeholder()}
                value={name}
                maxLength={60}
                ref={focusOnMount}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel id={scopeId}>{m.auth_account_tokens_scope_label()}</FieldLabel>
              <Select
                value={scope}
                items={scopeItems}
                onValueChange={(next) => setScope(next === 'write' ? 'write' : 'read')}
              >
                <SelectTrigger aria-labelledby={scopeId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {scopeItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel id={expiryId}>{m.auth_account_tokens_expiry_label()}</FieldLabel>
              <Select
                value={days}
                items={expiryItems}
                onValueChange={(next) => next && setDays(next)}
              >
                <SelectTrigger aria-labelledby={expiryId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {expiryItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <FieldError>{create.error ? errorMessage(create.error) : null}</FieldError>
            <DialogFooter>
              <Button type="submit" disabled={!name.trim()}>
                {create.isPending ? m.common_saving() : m.auth_account_tokens_create()}
              </Button>
            </DialogFooter>
          </FieldSet>
        </form>
      </DialogContent>
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
      <DialogContent>
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
      </DialogContent>
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
    <>
      {tokens.isPending ? (
        <p className="text-sm text-muted-foreground">{m.common_loading()}</p>
      ) : tokens.isError ? (
        <div className="space-y-2">
          <FieldError>{errorMessage(tokens.error)}</FieldError>
          <Button variant="outline" size="sm" onClick={() => void tokens.refetch()}>
            {m.common_retry()}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRound aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{m.auth_account_tokens_empty()}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {m.auth_account_tokens_create()}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <SettingsGroup>
          {items.map((t) => (
            <Item key={t.id}>
              <ItemContent className="min-w-0">
                <ItemTitle>
                  <span className="truncate">{t.name}</span>
                  <Badge variant="secondary">
                    {t.scopes.includes('write')
                      ? m.auth_account_tokens_scope_write()
                      : m.auth_account_tokens_scope_read()}
                  </Badge>
                </ItemTitle>
                <ItemDescription>
                  {[
                    `${t.prefix}…`,
                    t.last_used_at
                      ? m.auth_account_tokens_last_used({
                          time: formatDateTime(t.last_used_at),
                        })
                      : m.auth_account_tokens_never_used(),
                    t.expires_at
                      ? m.auth_account_tokens_expires_at({ time: formatDate(t.expires_at) })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  variant="destructive"
                  size="sm"
                  aria-label={m.auth_account_tokens_revoke_aria({ name: t.name })}
                  onClick={() => setRevoking({ id: t.id, name: t.name })}
                >
                  {m.auth_account_tokens_revoke()}
                </Button>
              </ItemActions>
            </Item>
          ))}
          <ActionRow icon={Plus} onClick={() => setCreating(true)}>
            {m.auth_account_tokens_create()}
          </ActionRow>
        </SettingsGroup>
      )}
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
    </>
  )
}
