import type { UserOut } from '@semestra/api-client'
import {
  accountEmailChangeConfirmMutation,
  accountEmailChangeStartMutation,
  accountGoogleLinkMutation,
  accountGoogleUnlinkMutation,
  accountProfileGetQueryKey,
  accountPasswordChangeMutation,
  authConfigOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { useId, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { SettingsGroup } from '@/app/settings'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { errorMessage, toastError } from '@/lib/errors'
import { ReauthFields, reauthState } from '@/modules/auth/components/ReauthFields'
import { focusOnMount } from '@/lib/focus'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Field, FieldError, FieldLabel, FieldSet } from '@/ui/field'
import { Input } from '@/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/ui/input-otp'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/ui/item'
import { GoogleSignInButton } from '../components/GoogleSignInButton'

function useUserCache() {
  const queryClient = useQueryClient()
  return (user: UserOut) => queryClient.setQueryData(accountProfileGetQueryKey(), user)
}

function EmailRow({ user }: { user: UserOut }) {
  const setUser = useUserCache()
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const start = useMutation(accountEmailChangeStartMutation())
  const { needsPassword } = reauthState(start.error)
  const confirm = useMutation({
    ...accountEmailChangeConfirmMutation(),
    onSuccess: (data) => {
      setUser(data)
      toast.success(m.auth_account_email_changed())
      close()
    },
    onError: () => setCode(''),
  })

  const close = () => {
    setEditing(false)
    setSentTo(null)
    setNewEmail('')
    setCode('')
    setPassword('')
    start.reset()
    confirm.reset()
  }

  const send = (e: FormEvent) => {
    e.preventDefault()
    const target = newEmail.trim()
    if (!target || (needsPassword && password === '')) return
    start.mutate(
      { body: { new_email: target, password: password === '' ? null : password } },
      { onSuccess: () => setSentTo(target) },
    )
  }

  return (
    <div>
      <Item>
        <ItemContent className="min-w-0">
          <ItemTitle>{m.auth_account_email_row()}</ItemTitle>
          <ItemDescription className="truncate">{user.email}</ItemDescription>
        </ItemContent>
        {editing ? null : (
          <ItemActions>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              {m.auth_account_email_change()}
            </Button>
          </ItemActions>
        )}
      </Item>
      {editing && !sentTo ? (
        <form
          onSubmit={send}
          className="mx-4 mb-4 space-y-3 rounded-2xl bg-muted/50 p-4"
          noValidate
        >
          <FieldSet disabled={start.isPending} className="gap-3">
            <Field>
              <FieldLabel htmlFor={id}>{m.auth_account_email_new_label()}</FieldLabel>
              <Input
                id={id}
                type="email"
                autoComplete="email"
                ref={focusOnMount}
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </Field>
            <ReauthFields error={start.error} password={password} onPasswordChange={setPassword} />
            <FieldError>
              {start.error && !reauthState(start.error).handled ? errorMessage(start.error) : null}
            </FieldError>
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={!newEmail.trim() || (needsPassword && password === '')}
              >
                {start.isPending ? m.auth_sending() : m.auth_account_email_send_code()}
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                {m.common_cancel()}
              </Button>
            </div>
          </FieldSet>
        </form>
      ) : null}
      {editing && sentTo ? (
        <div className="mx-4 mb-4 space-y-3 rounded-2xl bg-muted/50 p-4">
          <p className="text-sm">{m.auth_account_email_code_sent({ email: sentTo })}</p>
          <InputOTP
            maxLength={6}
            pattern={REGEXP_ONLY_DIGITS}
            value={code}
            onChange={setCode}
            onComplete={(value) => confirm.mutate({ body: { code: value } })}
            disabled={confirm.isPending}
            ref={focusOnMount}
            aria-label={m.auth_code_label()}
          >
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <FieldError>{confirm.error ? errorMessage(confirm.error) : null}</FieldError>
          <Button type="button" variant="ghost" onClick={close} disabled={confirm.isPending}>
            {m.common_cancel()}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function PasswordRow({ user }: { user: UserOut }) {
  const setUser = useUserCache()
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const change = useMutation({
    ...accountPasswordChangeMutation(),
    onSuccess: (data) => {
      setUser(data)
      toast.success(m.auth_account_password_changed())
      close()
    },
  })

  const close = () => {
    setEditing(false)
    setCurrent('')
    setNext('')
    change.reset()
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!next) return
    change.mutate({
      body: { current_password: user.has_password ? current : null, new_password: next },
    })
  }

  return (
    <div>
      <Item>
        <ItemContent className="min-w-0">
          <ItemTitle>{m.auth_account_password_row()}</ItemTitle>
          <ItemDescription>
            {user.has_password ? m.auth_account_password_set() : m.auth_account_password_not_set()}
          </ItemDescription>
        </ItemContent>
        {editing ? null : (
          <ItemActions>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              {user.has_password
                ? m.auth_account_password_change_action()
                : m.auth_account_password_set_action()}
            </Button>
          </ItemActions>
        )}
      </Item>
      {editing ? (
        <form
          onSubmit={submit}
          className="mx-4 mb-4 space-y-3 rounded-2xl bg-muted/50 p-4"
          noValidate
        >
          <FieldSet disabled={change.isPending} className="gap-3">
            {user.has_password ? (
              <Field>
                <FieldLabel htmlFor={`${id}-current`}>
                  {m.auth_account_password_current()}
                </FieldLabel>
                <Input
                  id={`${id}-current`}
                  type="password"
                  autoComplete="current-password"
                  ref={focusOnMount}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor={`${id}-new`}>{m.auth_account_password_new()}</FieldLabel>
              <Input
                id={`${id}-new`}
                type="password"
                autoComplete="new-password"
                ref={!user.has_password ? focusOnMount : undefined}
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </Field>
            <FieldError>{change.error ? errorMessage(change.error) : null}</FieldError>
            <div className="flex gap-2">
              <Button type="submit" disabled={!next}>
                {change.isPending ? m.common_saving() : m.common_save()}
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                {m.common_cancel()}
              </Button>
            </div>
          </FieldSet>
        </form>
      ) : null}
    </div>
  )
}

function GoogleRow({ user, clientId }: { user: UserOut; clientId: string | null | undefined }) {
  const setUser = useUserCache()
  const [confirming, setConfirming] = useState(false)
  const link = useMutation({
    ...accountGoogleLinkMutation(),
    onSuccess: (data) => {
      setUser(data)
      toast.success(m.auth_account_google_linked_done())
    },
  })
  const unlink = useMutation({
    ...accountGoogleUnlinkMutation(),
    onSuccess: (data) => {
      setUser(data)
      setConfirming(false)
    },
    onError: (err) => {
      setConfirming(false)
      toastError(err)
    },
  })

  const identity = user.identities.find((i) => i.provider === 'google')
  return (
    <div>
      <Item>
        <ItemContent className="min-w-0">
          <ItemTitle>{m.auth_account_google_row()}</ItemTitle>
          <ItemDescription>
            {identity
              ? m.auth_account_google_linked({ email: identity.email })
              : m.auth_account_google_not_linked()}
          </ItemDescription>
        </ItemContent>
        {identity ? (
          <ItemActions>
            <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
              {m.auth_account_google_unlink()}
            </Button>
          </ItemActions>
        ) : clientId ? (
          <ItemActions>
            <GoogleSignInButton
              clientId={clientId}
              variant="inline"
              onCredential={(idToken) => link.mutate({ body: { id_token: idToken } })}
            />
          </ItemActions>
        ) : null}
      </Item>
      {link.error ? (
        <FieldError className="mx-4 mb-3">{errorMessage(link.error)}</FieldError>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={m.auth_account_google_unlink_title()}
        description={m.auth_account_google_unlink_desc()}
        confirmLabel={m.auth_account_google_unlink()}
        pending={unlink.isPending}
        onConfirm={() => unlink.mutate({})}
      />
    </div>
  )
}

export function SignInMethodsSection({ user }: { user: UserOut }) {
  const config = useQuery(authConfigOptions())
  const clientId = config.data?.google_client_id
  const hasGoogle = user.identities.some((i) => i.provider === 'google') || Boolean(clientId)
  return (
    <SettingsGroup>
      <EmailRow user={user} />
      <PasswordRow user={user} />
      {hasGoogle ? <GoogleRow user={user} clientId={clientId} /> : null}
    </SettingsGroup>
  )
}
