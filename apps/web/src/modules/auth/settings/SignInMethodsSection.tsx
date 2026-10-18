import type { UserOut } from '@semestra/api-client'
import {
  accountEmailChangeConfirmMutation,
  accountEmailChangeStartMutation,
  accountGoogleLinkMutation,
  accountGoogleUnlinkMutation,
  accountMeGetQueryKey,
  accountPasswordChangeMutation,
  authConfigOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { TextField } from '@/components/TextField'
import { toastError } from '@/lib/errors'
import { focusOnMount } from '@/lib/focus'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/ui/input-otp'
import { Separator } from '@/ui/separator'
import { FormError } from '../components/FormError'
import { GoogleSignInButton } from '../components/GoogleSignInButton'
import { Row, SettingsCard } from './SettingsCard'

function useUserCache() {
  const queryClient = useQueryClient()
  return (user: UserOut) => queryClient.setQueryData(accountMeGetQueryKey(), user)
}

function EmailRow({ user }: { user: UserOut }) {
  const setUser = useUserCache()
  const [editing, setEditing] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const start = useMutation(accountEmailChangeStartMutation())
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
    start.reset()
    confirm.reset()
  }

  const send = (e: FormEvent) => {
    e.preventDefault()
    const target = newEmail.trim()
    if (!target) return
    start.mutate({ body: { new_email: target } }, { onSuccess: () => setSentTo(target) })
  }

  return (
    <div className="space-y-3">
      <Row
        label={m.auth_account_email_row()}
        value={user.email}
        action={
          editing ? null : (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              {m.auth_account_email_change()}
            </Button>
          )
        }
      />
      {editing && !sentTo ? (
        <form onSubmit={send} className="space-y-3 rounded-2xl bg-muted/50 p-4" noValidate>
          <fieldset disabled={start.isPending} className="space-y-3">
            <TextField
              type="email"
              autoComplete="email"
              ref={focusOnMount}
              label={m.auth_account_email_new_label()}
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <FormError error={start.error} />
            <div className="flex gap-2">
              <Button type="submit">
                {start.isPending ? m.auth_sending() : m.auth_account_email_send_code()}
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                {m.common_cancel()}
              </Button>
            </div>
          </fieldset>
        </form>
      ) : null}
      {editing && sentTo ? (
        <div className="space-y-3 rounded-2xl bg-muted/50 p-4">
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
          <FormError error={confirm.error} />
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
    <div className="space-y-3">
      <Row
        label={m.auth_account_password_row()}
        value={
          user.has_password ? m.auth_account_password_set() : m.auth_account_password_not_set()
        }
        action={
          editing ? null : (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              {user.has_password
                ? m.auth_account_password_change_action()
                : m.auth_account_password_set_action()}
            </Button>
          )
        }
      />
      {editing ? (
        <form onSubmit={submit} className="space-y-3 rounded-2xl bg-muted/50 p-4" noValidate>
          <fieldset disabled={change.isPending} className="space-y-3">
            {user.has_password ? (
              <TextField
                type="password"
                autoComplete="current-password"
                ref={focusOnMount}
                label={m.auth_account_password_current()}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            ) : null}
            <TextField
              type="password"
              autoComplete="new-password"
              ref={!user.has_password ? focusOnMount : undefined}
              label={m.auth_account_password_new()}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <FormError error={change.error} />
            <div className="flex gap-2">
              <Button type="submit" disabled={!next}>
                {change.isPending ? m.common_saving() : m.common_save()}
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                {m.common_cancel()}
              </Button>
            </div>
          </fieldset>
        </form>
      ) : null}
    </div>
  )
}

function GoogleRow({ user }: { user: UserOut }) {
  const setUser = useUserCache()
  const config = useQuery(authConfigOptions())
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
  const clientId = config.data?.google_client_id
  if (!identity && !clientId) return null

  return (
    <div className="space-y-3">
      <Row
        label={m.auth_account_google_row()}
        value={
          identity
            ? m.auth_account_google_linked({ email: identity.email })
            : m.auth_account_google_not_linked()
        }
        action={
          identity ? (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              {m.auth_account_google_unlink()}
            </Button>
          ) : null
        }
      />
      {!identity && clientId ? (
        <>
          <GoogleSignInButton
            clientId={clientId}
            onCredential={(idToken) => link.mutate({ body: { id_token: idToken } })}
          />
          <FormError error={link.error} />
        </>
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
  return (
    <SettingsCard title={m.auth_account_signin_title()} description={m.auth_account_signin_desc()}>
      <EmailRow user={user} />
      <Separator />
      <PasswordRow user={user} />
      <Separator />
      <GoogleRow user={user} />
    </SettingsCard>
  )
}
