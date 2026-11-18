import type { UserOut } from '@semestra/api-client'
import {
  accountProfileGetQueryKey,
  authEmailStartMutation,
  authPasswordResetMutation,
  authPasswordResetVerifyMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { useId, useState, type FormEvent } from 'react'
import { errorCode, errorMessage } from '@/lib/errors'
import { focusOnMount } from '@/lib/focus'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel, FieldSet } from '@/ui/field'
import { Input } from '@/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/ui/input-otp'
import { EmailField } from './EmailField'
import { useCountdown } from './useCountdown'
import { weakPasswordError } from './weak-password'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

type Step =
  | { name: 'email' }
  | { name: 'code'; resendAt: number }
  | { name: 'password'; token: string }

type Props = { initialEmail?: string; onSignedIn: (user: UserOut) => void }

function Heading({ subtitle }: { subtitle: string }) {
  return (
    <div className="mb-6 space-y-1.5">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{m.auth_reset_title()}</h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}

/**
 * Forgot password: email → code → new password → signed in (M01 §4.4). The code is checked on
 * its own step, so a rejected password is fixed in place without asking for a new code.
 */
export function ResetPasswordFlow({ initialEmail = '', onSignedIn }: Props) {
  const queryClient = useQueryClient()
  const id = useId()
  const [step, setStep] = useState<Step>({ name: 'email' })
  const [email, setEmail] = useState(initialEmail)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const resendIn = useCountdown(step.name === 'code' ? step.resendAt : 0)

  const start = useMutation(authEmailStartMutation())
  const verify = useMutation(authPasswordResetVerifyMutation())
  const reset = useMutation(authPasswordResetMutation())
  const trimmed = email.trim()

  const sendCode = (e?: FormEvent) => {
    e?.preventDefault()
    if (!EMAIL_RE.test(trimmed)) return setEmailError(m.auth_email_invalid())
    setEmailError(null)
    // A new code is on its way: errors about the old one no longer apply.
    verify.reset()
    reset.reset()
    start.mutate(
      { body: { email: trimmed, purpose: 'reset_password' } },
      {
        onSuccess: (data) => {
          setCode('')
          setStep({ name: 'code', resendAt: Date.now() + data.resend_in_seconds * 1000 })
        },
      },
    )
  }

  const verifyCode = (value: string) => {
    verify.mutate(
      { body: { email: trimmed, code: value } },
      {
        onSuccess: (data) => setStep({ name: 'password', token: data.reset_token }),
        onError: () => setCode(''),
      },
    )
  }

  const submitPassword = (e: FormEvent) => {
    e.preventDefault()
    if (step.name !== 'password' || !newPassword) return
    reset.mutate(
      { body: { reset_token: step.token, new_password: newPassword } },
      {
        onSuccess: (data) => {
          if (!data.user) return
          queryClient.setQueryData(accountProfileGetQueryKey(), data.user)
          onSignedIn(data.user)
        },
        // The verified code ran out (or was replaced): start over from the email step.
        onError: (err) => {
          if (errorCode(err) === 'auth.reset_expired') setStep({ name: 'email' })
        },
      },
    )
  }

  const back = (
    <Button variant="link" size="sm" nativeButton={false} render={<Link to="/login" />}>
      {m.auth_back_to_login()}
    </Button>
  )

  if (step.name === 'code') {
    const codeError = verify.error ?? start.error
    return (
      <div>
        <Heading subtitle={m.auth_reset_code_subtitle({ email: trimmed })} />
        <div className="space-y-4">
          <InputOTP
            maxLength={6}
            pattern={REGEXP_ONLY_DIGITS}
            value={code}
            onChange={setCode}
            onComplete={verifyCode}
            disabled={verify.isPending}
            ref={focusOnMount}
            aria-label={m.auth_code_label()}
            containerClassName="justify-center"
          >
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <InputOTPSlot key={i} index={i} aria-invalid={verify.isError || undefined} />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <div aria-live="polite" className="min-h-5 text-center">
            {verify.isPending ? (
              <p className="text-sm text-muted-foreground">{m.auth_code_verifying()}</p>
            ) : (
              <FieldError>{codeError ? errorMessage(codeError) : null}</FieldError>
            )}
          </div>
          <div className="flex flex-col items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={resendIn > 0 || start.isPending}
              onClick={() => sendCode()}
            >
              {resendIn > 0 ? m.auth_code_resend_in({ seconds: resendIn }) : m.auth_code_resend()}
            </Button>
            <Button
              type="button"
              variant="link"
              size="sm"
              disabled={verify.isPending}
              onClick={() => {
                verify.reset()
                start.reset()
                setStep({ name: 'email' })
              }}
            >
              {m.auth_code_other_email()}
            </Button>
            {back}
          </div>
        </div>
      </div>
    )
  }

  if (step.name === 'password') {
    const weak = weakPasswordError(reset.error)
    return (
      <form onSubmit={submitPassword} noValidate>
        <Heading subtitle={m.auth_reset_password_subtitle({ email: trimmed })} />
        <FieldSet disabled={reset.isPending} className="gap-4">
          <Field data-invalid={weak ? true : undefined}>
            <FieldLabel htmlFor={`${id}-new-password`}>
              {m.auth_reset_new_password_label()}
            </FieldLabel>
            <Input
              id={`${id}-new-password`}
              type="password"
              autoComplete="new-password"
              ref={focusOnMount}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              aria-invalid={weak ? true : undefined}
              aria-describedby={`${id}-new-password-hint`}
            />
            {/* The rule and the error share one line, so a rejected password moves nothing. */}
            {weak ? (
              <FieldError id={`${id}-new-password-hint`}>{weak}</FieldError>
            ) : (
              <FieldDescription id={`${id}-new-password-hint`}>
                {m.auth_password_rule()}
              </FieldDescription>
            )}
          </Field>
          <FieldError>{reset.error && !weak ? errorMessage(reset.error) : null}</FieldError>
          <Button type="submit" className="w-full" size="lg" disabled={!newPassword}>
            {reset.isPending ? m.auth_reset_working() : m.auth_reset_submit()}
          </Button>
        </FieldSet>
        <div className="mt-4 flex justify-center">{back}</div>
      </form>
    )
  }

  // Back here after the verified code ran out, the reason stays under the button.
  const emailStepError = start.error ?? reset.error
  return (
    <form onSubmit={sendCode} noValidate>
      <Heading subtitle={m.auth_reset_subtitle()} />
      <FieldSet disabled={start.isPending} className="gap-4">
        <EmailField value={email} onValueChange={setEmail} error={emailError} ref={focusOnMount} />
        <FieldError>{emailStepError ? errorMessage(emailStepError) : null}</FieldError>
        <Button type="submit" className="w-full" size="lg">
          {start.isPending ? m.auth_sending() : m.auth_reset_send()}
        </Button>
      </FieldSet>
      <div className="mt-4 flex justify-center">{back}</div>
    </form>
  )
}
