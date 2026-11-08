import {
  accountReauthEmailStartMutation,
  accountReauthEmailVerifyMutation,
  accountReauthGoogleMutation,
  accountReauthPasswordMutation,
  authConfigOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { useId, useState } from 'react'
import { errorCode, errorMessage } from '@/lib/errors'
import { focusOnMount } from '@/lib/focus'
import { useUser } from '@/modules/auth/useAuth'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel, FieldSet, FieldTitle } from '@/ui/field'
import { Input } from '@/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/ui/input-otp'
import { GoogleSignInButton } from './GoogleSignInButton'
import { useCountdown } from './useCountdown'

/** Whether a sensitive action was refused until the user confirms who they are (M01 §4.5). */
export function needsReauth(error: unknown): boolean {
  return Boolean(error) && errorCode(error) === 'auth.reauth_required'
}

type Method = 'password' | 'email'

/**
 * Confirms who is using this session right where a sensitive action was refused: with the
 * password, a code emailed to the account, or the linked Google account. `onVerified` then sends
 * the action again; for the next 10 minutes the server does not ask again.
 *
 * Renders nothing unless `error` is `auth.reauth_required`. It may sit inside the action's form,
 * so none of its controls submit that form.
 */
export function ReauthStep({ error, onVerified }: { error: unknown; onVerified: () => void }) {
  if (!needsReauth(error)) return null
  return <ReauthChoice onVerified={onVerified} />
}

function ReauthChoice({ onVerified }: { onVerified: () => void }) {
  const titleId = useId()
  const user = useUser()
  const clientId = useQuery(authConfigOptions()).data?.google_client_id
  const googleLinked = user.identities.some((i) => i.provider === 'google')
  const [method, setMethod] = useState<Method>(user.has_password ? 'password' : 'email')
  const google = useMutation({ ...accountReauthGoogleMutation(), onSuccess: onVerified })

  return (
    <FieldSet aria-labelledby={titleId} className="gap-3 rounded-2xl bg-muted/50 p-4">
      <div className="flex flex-col gap-1">
        <FieldTitle id={titleId}>{m.auth_reauth_title()}</FieldTitle>
        <FieldDescription>{m.auth_reauth_desc()}</FieldDescription>
      </div>
      {method === 'password' ? (
        <PasswordMethod onVerified={onVerified} onUseEmail={() => setMethod('email')} />
      ) : (
        <EmailMethod
          email={user.email}
          onVerified={onVerified}
          onUsePassword={user.has_password ? () => setMethod('password') : undefined}
        />
      )}
      {googleLinked && clientId ? (
        <div className="flex flex-col items-start gap-1">
          <GoogleSignInButton
            clientId={clientId}
            text="signin_with"
            variant="inline"
            onCredential={(idToken) => google.mutate({ body: { id_token: idToken } })}
          />
          <FieldError>{google.error ? errorMessage(google.error) : null}</FieldError>
        </div>
      ) : null}
    </FieldSet>
  )
}

function PasswordMethod({
  onVerified,
  onUseEmail,
}: {
  onVerified: () => void
  onUseEmail: () => void
}) {
  const id = useId()
  const [password, setPassword] = useState('')
  const check = useMutation({ ...accountReauthPasswordMutation(), onSuccess: onVerified })
  const confirm = () => {
    if (password !== '' && !check.isPending) check.mutate({ body: { password } })
  }

  return (
    <Field data-invalid={check.isError || undefined}>
      <FieldLabel htmlFor={id}>{m.auth_reauth_password()}</FieldLabel>
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="current-password"
          ref={focusOnMount}
          aria-invalid={check.isError || undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            // The action's own form is around this field: Enter confirms, it does not submit.
            if (e.key === 'Enter') {
              e.preventDefault()
              confirm()
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={password === '' || check.isPending}
          onClick={confirm}
        >
          {m.auth_reauth_confirm()}
        </Button>
      </div>
      <FieldError>{check.error ? errorMessage(check.error) : null}</FieldError>
      <div>
        <Button type="button" variant="link" size="sm" className="px-0" onClick={onUseEmail}>
          {m.auth_reauth_use_email()}
        </Button>
      </div>
    </Field>
  )
}

function EmailMethod({
  email,
  onVerified,
  onUsePassword,
}: {
  email: string
  onVerified: () => void
  onUsePassword?: () => void
}) {
  const [resendAt, setResendAt] = useState<number | null>(null)
  const [code, setCode] = useState('')
  const resendIn = useCountdown(resendAt ?? 0)
  const start = useMutation({
    ...accountReauthEmailStartMutation(),
    onSuccess: (data) => setResendAt(Date.now() + data.resend_in_seconds * 1000),
  })
  const verify = useMutation({
    ...accountReauthEmailVerifyMutation(),
    onSuccess: onVerified,
    onError: () => setCode(''),
  })
  const send = () => {
    verify.reset()
    start.mutate({})
  }
  const switchBack = onUsePassword ? (
    <div>
      <Button type="button" variant="link" size="sm" className="px-0" onClick={onUsePassword}>
        {m.auth_reauth_use_password()}
      </Button>
    </div>
  ) : null

  if (resendAt === null) {
    return (
      <Field>
        <div>
          <Button type="button" variant="secondary" disabled={start.isPending} onClick={send}>
            {start.isPending ? m.auth_sending() : m.auth_reauth_send_code({ email })}
          </Button>
        </div>
        <FieldError>{start.error ? errorMessage(start.error) : null}</FieldError>
        {switchBack}
      </Field>
    )
  }

  const codeError = verify.error ?? start.error
  return (
    <Field data-invalid={verify.isError || undefined}>
      <FieldDescription>{m.auth_code_subtitle({ email })}</FieldDescription>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <InputOTP
          maxLength={6}
          pattern={REGEXP_ONLY_DIGITS}
          value={code}
          onChange={setCode}
          onComplete={(value) => verify.mutate({ body: { code: value } })}
          disabled={verify.isPending}
          ref={focusOnMount}
          aria-label={m.auth_code_label()}
        >
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} aria-invalid={verify.isError || undefined} />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="px-0"
          disabled={resendIn > 0 || start.isPending}
          onClick={send}
        >
          {resendIn > 0 ? m.auth_code_resend_in({ seconds: resendIn }) : m.auth_code_resend()}
        </Button>
      </div>
      <FieldError>{codeError ? errorMessage(codeError) : null}</FieldError>
      {switchBack}
    </Field>
  )
}
