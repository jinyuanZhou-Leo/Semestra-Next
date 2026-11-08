import type { TokenCreated, TokenOut } from '@semestra/api-client'
import {
  accountTokenCreateMutation,
  accountTokenListOptions,
  accountTokenListQueryKey,
  accountTokenRevokeMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { Ban, KeyRound, Plus } from 'lucide-react'
import { createContext, use, useId, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { RowMenu, SectionAction, SettingsTable, settingsTableFeatures } from '@/app/settings'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { type DialogTargetProps, useDialogTarget } from '@/lib/dialog-target'
import { errorMessage, toastError } from '@/lib/errors'
import { ReauthStep, needsReauth } from '@/modules/auth/components/ReauthStep'
import { formatDate, formatDateTime } from '@/lib/format'
import { focusOnMount } from '@/lib/focus'
import { m } from '@/paraglide/messages'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { Field, FieldError, FieldLabel, FieldSet } from '@/ui/field'
import { Input } from '@/ui/input'
import { DropdownMenuItem } from '@/ui/dropdown-menu'
import { ChoiceControl, type ChoiceOption } from '@/app/settings/choice'

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
  const scopeItems: ChoiceOption<'read' | 'write'>[] = [
    { value: 'read', label: m.auth_account_tokens_scope_read() },
    { value: 'write', label: m.auth_account_tokens_scope_write() },
  ]
  const expiryItems: ChoiceOption<string>[] = [
    { value: 'never', label: m.auth_account_tokens_expiry_never() },
    ...[30, 90, 365].map((d) => ({
      value: String(d),
      label: m.auth_account_tokens_expiry_days({ days: d }),
    })),
  ]
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'read' | 'write'>('read')
  const [days, setDays] = useState('never')
  const create = useMutation({
    ...accountTokenCreateMutation(),
    onSuccess: (token) => {
      setName('')
      setScope('read')
      setDays('never')
      onCreated(token)
    },
  })
  const reauth = needsReauth(create.error)

  // Also sent again once the user confirms it's them: with what the form shows by then.
  const save = () => {
    if (!name.trim()) return
    create.mutate({
      body: {
        name: name.trim(),
        scopes: scope === 'write' ? ['read', 'write'] : ['read'],
        expires_in_days: days === 'never' ? null : Number(days),
      },
    })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save()
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
              <ChoiceControl
                labelId={scopeId}
                value={scope}
                onChange={setScope}
                options={scopeItems}
              />
            </Field>
            <Field>
              <FieldLabel id={expiryId}>{m.auth_account_tokens_expiry_label()}</FieldLabel>
              <ChoiceControl
                labelId={expiryId}
                value={days}
                onChange={setDays}
                options={expiryItems}
              />
            </Field>
            <ReauthStep error={create.error} onVerified={save} />
            <FieldError>{create.error && !reauth ? errorMessage(create.error) : null}</FieldError>
            <DialogFooter>
              <DialogClose
                render={<Button type="button" variant="outline" disabled={create.isPending} />}
              >
                {m.common_cancel()}
              </DialogClose>
              <Button type="submit" disabled={!name.trim() || reauth}>
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
  ...props
}: { token: TokenCreated | null } & DialogTargetProps) {
  return (
    <Dialog {...props}>
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
            <Button variant="outline" size="sm" onClick={() => void copy(token.token)}>
              {m.auth_account_tokens_copy_token()}
            </Button>
          </div>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button />}>{m.auth_account_tokens_done()}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const RevokeContext = createContext<(token: TokenOut) => void>(() => {})

type CellProps = CellContext<typeof settingsTableFeatures, TokenOut>

function NameCell({ row }: CellProps) {
  const t = row.original
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
        <KeyRound aria-hidden className="size-4 text-muted-foreground" />
      </span>
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

export function TokensSection() {
  const queryClient = useQueryClient()
  const tokens = useQuery(accountTokenListOptions())
  const [creating, setCreating] = useState(false)
  const created = useDialogTarget<TokenCreated>()
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
              <EmptyTitle>{m.auth_account_tokens_empty()}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus aria-hidden />
                {m.auth_account_tokens_create()}
              </Button>
            </EmptyContent>
          </Empty>
        }
      >
        {(page) => (
          <RevokeContext value={(t) => revoking.show({ id: t.id, name: t.name })}>
            <SectionAction>
              <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                <Plus aria-hidden />
                {m.auth_account_tokens_create()}
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
      <CreateTokenDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(token) => {
          setCreating(false)
          created.show(token)
          void refresh()
        }}
      />
      <TokenCreatedDialog token={created.target} {...created.props} />
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
