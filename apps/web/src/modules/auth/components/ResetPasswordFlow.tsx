import type { UserOut } from '@semestra/api-client'
import {
  accountMeGetQueryKey,
  authEmailStartMutation,
  authPasswordResetMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { useId, useState, type FormEvent } from 'react'
import { errorMessage } from '@/lib/errors'
import { focusOnMount } from '@/lib/focus'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Field, FieldError, FieldLabel, FieldSet } from '@/ui/field'
import { Input } from '@/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/ui/input-otp'
import { EmailField } from './EmailField'
import { useCountdown } from './useCountdown'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

type Props = { initialEmail?: string; onSignedIn: (user: UserOut) => void }

/** Forgot password: email → code + new password → signed in (M01 §4.4). */
export function ResetPasswordFlow({ initialEmail = '', onSignedIn }: Props) {
  const queryClient = useQueryClient()
  const id = useId()
  const [email, setEmail] = useState(initialEmail)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [resendAt, setResendAt] = useState<number | null>(null)
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const resendIn = useCountdown(resendAt ?? 0)

  const start = useMutation(authEmailStartMutation())
  const reset = useMutation(authPasswordResetMutation())
  const trimmed = email.trim()

  const sendCode = (e?: FormEvent) => {
    e?.preventDefault()
    if (!EMAIL_RE.test(trimmed)) return setEmailError(m.auth_email_invalid())
    setEmailError(null)
    start.mutate(
      { body: { email: trimmed, purpose: 'reset_password' } },
      { onSuccess: (data) => setResendAt(Date.now() + data.resend_in_seconds * 1000) },
    )
  }

  const submitReset = (e: FormEvent) => {
    e.preventDefault()
    if (code.length < 6 || !newPassword) return
    reset.mutate(
      { body: { email: trimmed, code, new_password: newPassword } },
      {
        onSuccess: (data) => {
          if (!data.user) return
          queryClient.setQueryData(accountMeGetQueryKey(), data.user)
          onSignedIn(data.user)
        },
        onError: () => setCode(''),
      },
    )
  }

  const back = (
    <Button variant="link" size="sm" nativeButton={false} render={<Link to="/login" />}>
      {m.auth_back_to_login()}
    </Button>
  )

  if (resendAt === null) {
    return (
      <form onSubmit={sendCode} noValidate>
        <div className="mb-6 space-y-1.5">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {m.auth_reset_title()}
          </h1>
          <p className="text-sm text-muted-foreground">{m.auth_reset_subtitle()}</p>
        </div>
        <FieldSet disabled={start.isPending} className="gap-4">
          <EmailField
            value={email}
            onValueChange={setEmail}
            error={emailError}
            ref={focusOnMount}
          />
          <FieldError>{start.error ? errorMessage(start.error) : null}</FieldError>
          <Button type="submit" className="w-full" size="lg">
            {start.isPending ? m.auth_sending() : m.auth_reset_send()}
          </Button>
        </FieldSet>
        <div className="mt-4 flex justify-center">{back}</div>
      </form>
    )
  }

  const resetError = reset.error ?? start.error
  return (
    <form onSubmit={submitReset} noValidate>
      <div className="mb-6 space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {m.auth_reset_title()}
        </h1>
        <p className="text-sm text-muted-foreground">
          {m.auth_reset_code_subtitle({ email: trimmed })}
        </p>
      </div>
      <FieldSet disabled={reset.isPending} className="gap-4">
        <InputOTP
          maxLength={6}
          pattern={REGEXP_ONLY_DIGITS}
          value={code}
          onChange={setCode}
          ref={focusOnMount}
          aria-label={m.auth_code_label()}
          containerClassName="justify-center"
        >
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <Field>
          <FieldLabel htmlFor={`${id}-new-password`}>
            {m.auth_reset_new_password_label()}
          </FieldLabel>
          <Input
            id={`${id}-new-password`}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </Field>
        <FieldError>{resetError ? errorMessage(resetError) : null}</FieldError>
        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={code.length < 6 || !newPassword}
        >
          {reset.isPending ? m.auth_reset_working() : m.auth_reset_submit()}
        </Button>
      </FieldSet>
      <div className="mt-4 flex flex-col items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={resendIn > 0 || start.isPending}
          onClick={() => sendCode()}
        >
          {resendIn > 0 ? m.auth_code_resend_in({ seconds: resendIn }) : m.auth_code_resend()}
        </Button>
        {back}
      </div>
    </form>
  )
}
