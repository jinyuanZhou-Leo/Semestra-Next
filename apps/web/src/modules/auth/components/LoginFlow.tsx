import type { UserOut } from '@semestra/api-client'
import {
  accountMeGetQueryKey,
  authConfigOptions,
  authEmailStartMutation,
  authEmailVerifyMutation,
  authGoogleLoginMutation,
  authPasswordLoginMutation,
  authRegisterCompleteMutation,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { useState, type FormEvent, type ReactNode } from 'react'
import { TextField } from '@/components/TextField'
import { focusOnMount } from '@/lib/focus'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/ui/input-otp'
import { Separator } from '@/ui/separator'
import { EmailField } from './EmailField'
import { FormError } from './FormError'
import { GoogleSignInButton } from './GoogleSignInButton'
import { useCountdown } from './useCountdown'

type Step =
  | { name: 'email' }
  | { name: 'password'; focusPassword: boolean }
  | { name: 'code'; resendAt: number }
  | { name: 'profile'; token: string }

type Props = {
  onSignedIn: (user: UserOut) => void
  initialEmail?: string
  /** Re-login inside the session-expired dialog: fixed email, no way to leave the page. */
  compact?: boolean
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function Heading({ title, subtitle }: { title: string; subtitle: ReactNode }) {
  return (
    <div className="mb-6 space-y-1.5">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}

/** The unified entry (M01 §7): email → code → (new users) profile, or password, or Google. */
export function LoginFlow({ onSignedIn, initialEmail = '', compact = false }: Props) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>({ name: 'email' })
  const [email, setEmail] = useState(initialEmail)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const config = useQuery(authConfigOptions())
  const googleClientId = config.data?.google_client_id

  const finish = (user: UserOut | null | undefined) => {
    if (!user) return
    queryClient.setQueryData(accountMeGetQueryKey(), user)
    onSignedIn(user)
  }

  const start = useMutation(authEmailStartMutation())
  const verify = useMutation(authEmailVerifyMutation())
  const register = useMutation(authRegisterCompleteMutation())
  const passwordLogin = useMutation(authPasswordLoginMutation())
  const googleLogin = useMutation(authGoogleLoginMutation())
  const resendIn = useCountdown(step.name === 'code' ? step.resendAt : 0)

  const trimmedEmail = email.trim()
  const sendCode = (onSent?: () => void) => {
    if (!EMAIL_RE.test(trimmedEmail)) {
      setEmailError(m.auth_email_invalid())
      return
    }
    setEmailError(null)
    start.mutate(
      { body: { email: trimmedEmail, purpose: 'continue' } },
      {
        onSuccess: (data) => {
          setCode('')
          setStep({ name: 'code', resendAt: Date.now() + data.resend_in_seconds * 1000 })
          onSent?.()
        },
      },
    )
  }

  const verifyCode = (value: string) => {
    verify.mutate(
      { body: { email: trimmedEmail, code: value } },
      {
        onSuccess: (data) => {
          if (data.status === 'needs_profile' && data.registration_token) {
            setStep({ name: 'profile', token: data.registration_token })
          } else {
            finish(data.user)
          }
        },
        onError: () => setCode(''),
      },
    )
  }

  const submitEmail = (e: FormEvent) => {
    e.preventDefault()
    sendCode()
  }

  const submitProfile = (e: FormEvent) => {
    e.preventDefault()
    if (step.name !== 'profile') return
    if (!displayName.trim()) {
      setNameError(m.auth_display_name_required())
      return
    }
    setNameError(null)
    register.mutate(
      {
        body: {
          registration_token: step.token,
          display_name: displayName.trim(),
          password: password || null,
        },
      },
      { onSuccess: (data) => finish(data.user) },
    )
  }

  const submitPassword = (e: FormEvent) => {
    e.preventDefault()
    if (!EMAIL_RE.test(trimmedEmail)) return setEmailError(m.auth_email_invalid())
    if (!password) return setPasswordError(m.auth_password_required())
    setEmailError(null)
    setPasswordError(null)
    passwordLogin.mutate(
      { body: { email: trimmedEmail, password } },
      { onSuccess: (data) => finish(data.user) },
    )
  }

  const google = googleClientId ? (
    <GoogleSignInButton
      clientId={googleClientId}
      onCredential={(idToken) =>
        googleLogin.mutate({ body: { id_token: idToken } }, { onSuccess: (d) => finish(d.user) })
      }
    />
  ) : null

  if (step.name === 'code') {
    return (
      <div>
        <Heading
          title={m.auth_code_title()}
          subtitle={m.auth_code_subtitle({ email: trimmedEmail })}
        />
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
              <FormError error={verify.error ?? start.error} />
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
          </div>
        </div>
      </div>
    )
  }

  if (step.name === 'profile') {
    return (
      <form onSubmit={submitProfile} noValidate>
        <Heading title={m.auth_profile_title()} subtitle={m.auth_profile_subtitle()} />
        <fieldset disabled={register.isPending} className="space-y-4">
          <TextField
            label={m.auth_display_name_label()}
            autoComplete="nickname"
            ref={focusOnMount}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            error={nameError}
            maxLength={60}
          />
          <TextField
            type="password"
            autoComplete="new-password"
            label={m.auth_password_optional_label()}
            hint={m.auth_password_optional_hint()}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <FormError error={register.error} />
          <Button type="submit" className="w-full" size="lg">
            {register.isPending ? m.auth_creating() : m.auth_create_account()}
          </Button>
        </fieldset>
      </form>
    )
  }

  if (step.name === 'password') {
    return (
      <form onSubmit={submitPassword} noValidate>
        <Heading title={m.auth_password_title()} subtitle={m.auth_login_subtitle()} />
        <fieldset disabled={passwordLogin.isPending} className="space-y-4">
          <EmailField
            value={email}
            onValueChange={setEmail}
            error={emailError}
            ref={step.focusPassword ? undefined : focusOnMount}
          />
          <TextField
            type="password"
            autoComplete="current-password"
            label={m.auth_password_label()}
            ref={step.focusPassword ? focusOnMount : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={passwordError}
          />
          <FormError error={passwordLogin.error} />
          <Button type="submit" className="w-full" size="lg">
            {passwordLogin.isPending ? m.auth_signing_in() : m.auth_signin()}
          </Button>
        </fieldset>
        <div className="mt-4 flex flex-col items-center gap-1">
          {compact ? null : (
            <Button
              variant="link"
              size="sm"
              render={<Link to="/login/reset" search={{ email: trimmedEmail || undefined }} />}
            >
              {m.auth_forgot_password()}
            </Button>
          )}
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => {
              passwordLogin.reset()
              setStep({ name: 'email' })
            }}
          >
            {m.auth_use_code()}
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div>
      <Heading title={m.auth_login_title()} subtitle={m.auth_login_subtitle()} />
      <form onSubmit={submitEmail} noValidate className="space-y-4">
        <fieldset disabled={start.isPending} className="space-y-4">
          <EmailField
            value={email}
            onValueChange={setEmail}
            error={emailError}
            ref={focusOnMount}
            readOnly={compact && Boolean(initialEmail)}
          />
          <FormError error={start.error} />
          <Button type="submit" className="w-full" size="lg">
            {start.isPending ? m.auth_sending() : m.auth_continue()}
          </Button>
        </fieldset>
      </form>
      <div className="mt-4 flex justify-center">
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => setStep({ name: 'password', focusPassword: Boolean(trimmedEmail) })}
        >
          {m.auth_use_password()}
        </Button>
      </div>
      {google ? (
        <div className="mt-2 space-y-4">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            {m.auth_or()}
            <Separator className="flex-1" />
          </div>
          {google}
          <FormError error={googleLogin.error} />
        </div>
      ) : null}
    </div>
  )
}
