import {
  accountPasskeyRegister,
  accountPasskeyRegisterOptions,
  type PasskeyOut,
} from '@semestra/api-client'
import {
  accountPasskeyDeleteMutation,
  accountPasskeyListOptions,
  accountPasskeyListQueryKey,
  accountPasskeyRenameMutation,
  accountProfileGetQueryKey,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type CellContext, createColumnHelper } from '@tanstack/react-table'
import { Fingerprint, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
import { createContext, type FormEvent, use, useId, useState } from 'react'
import { toast } from 'sonner'
import { RowMenu, SectionAction, SettingsTable, settingsTableFeatures } from '@/app/settings'
import { SettingsNote } from '@/app/settings/rows'
import { AsyncBoundary } from '@/components/AsyncBoundary'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { deviceLabel } from '@/lib/device'
import { useDialogTarget } from '@/lib/dialog-target'
import { errorMessage, toastError } from '@/lib/errors'
import { formatDate, formatDateTime } from '@/lib/format'
import { ReauthGate, useReauthRequired } from '@/modules/auth/components/ReauthGate'
import { createPasskey, passkeyCancelled, passkeysSupported } from '@/modules/auth/passkey'
import { m } from '@/paraglide/messages'
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
import { DropdownMenuItem, DropdownMenuSeparator } from '@/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/empty'
import { Field, FieldError, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'

// Settings → Account → Passkeys (M01 §4.9): the passkeys that can sign in to this account.

type Handlers = { onRename: (p: PasskeyOut) => void; onDelete: (p: PasskeyOut) => void }
const HandlersContext = createContext<Handlers>({ onRename: () => {}, onDelete: () => {} })

type CellProps = CellContext<typeof settingsTableFeatures, PasskeyOut>

function passkeyName(p: PasskeyOut): string {
  return p.name ?? m.auth_passkeys_unnamed()
}

function NameCell({ row }: CellProps) {
  const p = row.original
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
        <KeyRound aria-hidden className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0">
        <div className="truncate font-medium">{passkeyName(p)}</div>
        <div className="truncate text-xs text-muted-foreground">
          {[
            m.auth_passkeys_added({ date: formatDate(p.created_at) }),
            p.last_used_at
              ? m.auth_passkeys_last_used({ time: formatDateTime(p.last_used_at) })
              : m.auth_passkeys_never_used(),
          ].join(' · ')}
        </div>
      </div>
    </div>
  )
}

function ActionsCell({ row }: CellProps) {
  const { onRename, onDelete } = use(HandlersContext)
  const p = row.original
  return (
    <RowMenu label={m.auth_passkeys_actions({ name: passkeyName(p) })}>
      <DropdownMenuItem onClick={() => onRename(p)}>
        <Pencil aria-hidden />
        {m.auth_passkeys_rename()}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => onDelete(p)}>
        <Trash2 aria-hidden />
        {m.common_delete()}
      </DropdownMenuItem>
    </RowMenu>
  )
}

const column = createColumnHelper<typeof settingsTableFeatures, PasskeyOut>()
const columns = column.columns([
  column.display({ id: 'name', header: () => m.auth_passkeys_name(), cell: NameCell }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">{m.common_actions()}</span>,
    cell: ActionsCell,
  }),
])

const COLUMN_CLASS: Record<string, string> = { name: 'w-full max-w-0', actions: 'w-10' }

export function PasskeysSection() {
  const queryClient = useQueryClient()
  const passkeys = useQuery(accountPasskeyListOptions())
  const supported = passkeysSupported()
  const [adding, setAdding] = useState(false)
  const renaming = useDialogTarget<PasskeyOut>()
  const deleting = useDialogTarget<PasskeyOut>()

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: accountPasskeyListQueryKey() })
    // `has_passkey` decides whether confirming it's you offers a passkey.
    void queryClient.invalidateQueries({ queryKey: accountProfileGetQueryKey() })
  }
  const rename = useMutation({
    ...accountPasskeyRenameMutation(),
    onSuccess: () => (renaming.close(), refresh()),
  })
  const remove = useMutation({
    ...accountPasskeyDeleteMutation(),
    onSuccess: () => (deleting.close(), refresh()),
    onError: (err) => (deleting.close(), toastError(err)),
  })

  const addButton = (
    <Button size="sm" disabled={!supported} onClick={() => setAdding(true)}>
      <Plus aria-hidden />
      {m.auth_passkeys_add()}
    </Button>
  )

  return (
    <>
      <AsyncBoundary
        query={passkeys}
        isEmpty={(data) => data.items.length === 0}
        empty={
          <Empty className="rounded-2xl border border-solid border-border p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Fingerprint aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{m.auth_passkeys_empty()}</EmptyTitle>
              <EmptyDescription>
                {supported ? m.auth_passkeys_empty_desc() : m.auth_passkeys_unsupported()}
              </EmptyDescription>
            </EmptyHeader>
            {supported ? <EmptyContent>{addButton}</EmptyContent> : null}
          </Empty>
        }
      >
        {({ items }) => (
          <HandlersContext value={{ onRename: renaming.show, onDelete: deleting.show }}>
            <SectionAction>{addButton}</SectionAction>
            <SettingsTable
              label={m.auth_passkeys_title()}
              data={items}
              columns={columns}
              getRowId={(p) => p.id}
              columnClassName={COLUMN_CLASS}
            />
            {supported ? null : <SettingsNote>{m.auth_passkeys_unsupported()}</SettingsNote>}
          </HandlersContext>
        )}
      </AsyncBoundary>
      <AddPasskeyDialog
        open={adding}
        onOpenChange={setAdding}
        onAdded={() => {
          setAdding(false)
          refresh()
          toast.success(m.auth_passkeys_added_toast())
        }}
      />
      <RenameDialog
        {...renaming.props}
        passkey={renaming.target}
        pending={rename.isPending}
        error={rename.error}
        onSubmit={(name) =>
          renaming.target &&
          rename.mutate({ path: { passkey_id: renaming.target.id }, body: { name } })
        }
      />
      <ConfirmDialog
        {...deleting.props}
        title={m.auth_passkeys_delete_title()}
        description={m.auth_passkeys_delete_desc()}
        confirmLabel={m.common_delete()}
        pending={remove.isPending}
        onConfirm={() =>
          deleting.target && remove.mutate({ path: { passkey_id: deleting.target.id } })
        }
      />
    </>
  )
}

/**
 * Adding needs a recent confirmation that it is the user, and the browser only shows its
 * prompt in answer to a click: so the dialog confirms first, then "Continue" starts it.
 */
function AddPasskeyDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: () => void
}) {
  const add = useMutation({
    mutationFn: async () => {
      const { data: options } = await accountPasskeyRegisterOptions({ throwOnError: true })
      const credential = await createPasskey(options)
      const { data } = await accountPasskeyRegister({
        body: {
          challenge_id: options.challenge_id,
          credential,
          device: deviceLabel(navigator.userAgent),
        },
        throwOnError: true,
      })
      return data
    },
    onSuccess: onAdded,
  })
  const reauth = useReauthRequired(add.error, open)
  const error = add.error && !passkeyCancelled(add.error) ? add.error : null
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !add.isPending && onOpenChange(next)}
      onOpenChangeComplete={(next) => !next && add.reset()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.auth_passkeys_add()}</DialogTitle>
        </DialogHeader>
        {/* Not sent again on its own: the browser shows its prompt only in answer to a click. */}
        <ReauthGate
          error={add.error}
          enabled={open}
          onVerified={() => add.reset()}
          className="items-center justify-center gap-3 py-2 text-center"
        >
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted">
            <Fingerprint aria-hidden className="size-6 text-muted-foreground" />
          </span>
          <DialogDescription className="max-w-sm">{m.auth_passkeys_add_desc()}</DialogDescription>
          <FieldError className="min-h-5">
            {error && !reauth ? errorMessage(error) : null}
          </FieldError>
        </ReauthGate>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>{m.common_cancel()}</DialogClose>
          <Button disabled={reauth || add.isPending} onClick={() => add.mutate()}>
            {m.auth_passkeys_continue()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RenameDialog({
  passkey,
  open,
  onOpenChange,
  onOpenChangeComplete,
  pending,
  error,
  onSubmit,
}: {
  passkey: PasskeyOut | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenChangeComplete: (open: boolean) => void
  pending: boolean
  error: unknown
  onSubmit: (name: string) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState<{ for: string | null; value: string }>({
    for: null,
    value: '',
  })
  // Starts from the passkey's name each time the dialog is about another one.
  const value = draft.for === passkey?.id ? draft.value : passkey ? passkeyName(passkey) : ''
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (value.trim()) onSubmit(value.trim())
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.auth_passkeys_rename_title()}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={id}>{m.auth_passkeys_name()}</FieldLabel>
            <Input
              id={id}
              maxLength={60}
              value={value}
              onChange={(e) => setDraft({ for: passkey?.id ?? null, value: e.target.value })}
            />
            {error ? <FieldError>{errorMessage(error)}</FieldError> : null}
          </Field>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {m.common_cancel()}
            </DialogClose>
            <Button type="submit" disabled={pending || !value.trim()}>
              {m.common_save()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
