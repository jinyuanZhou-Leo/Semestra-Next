import type { ReauthStatus } from '@semestra/api-client'
import {
  accountReauthEmailStartMutation,
  accountReauthEmailVerifyMutation,
  accountReauthGoogleMutation,
  accountReauthPasswordMutation,
  accountReauthStatusOptions,
  accountReauthStatusQueryKey,
  authConfigOptions,
} from '@semestra/api-client/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { useNow } from '@/hooks/use-now'
import { errorCode, errorMessage } from '@/lib/errors'
import { focusOnMount } from '@/lib/focus'
import { cn } from '@/lib/utils'
import { useUser } from '@/modules/auth/useAuth'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { FieldDescription, FieldError, FieldLabel, FieldSet, FieldTitle } from '@/ui/field'
import { Input } from '@/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/ui/input-otp'
import { GoogleSignInButton } from './GoogleSignInButton'
import { useCountdown } from './useCountdown'

/** Whether a sensitive action was refused until the user confirms who they are (M01 §4.7). */
export function needsReauth(error: unknown): boolean {
  return Boolean(error) && errorCode(error) === 'auth.reauth_required'
}

/**
 * Whether the user has to confirm it's them before a sensitive action: the session's last check
 * is over 10 minutes old (`account.reauth.status`), or the action was refused for that anyway.
 */
export function useReauthRequired(error: unknown, enabled = true): boolean {
  const status = useQuery({ ...accountReauthStatusOptions(), enabled })
  // Counted from when the answer arrived, so the browser's clock does not need to match.
  const until = status.data ? status.dataUpdatedAt + status.data.remaining_seconds * 1000 : null
  const now = useNow(5_000, (at) => until !== null && at < until)
  return needsReauth(error) || (enabled && until !== null && now >= until)
}

/**
 * Wraps a sensitive action's fields (M01 §4.7). When the user has to confirm it's them first,
 * the confirmation takes the fields' place, in the same space: both are stacked in one grid
 * cell, so the dialog or row keeps its height while one fades into the other. Confirming shows
 * the fields again; if the action had already been refused, `onVerified` sends it again.
 *
 * Disable the action's own submit button while `useReauthRequired` is true.
 */
export function ReauthGate({
  error,
  enabled = true,
  onVerified,
  onCancel,
  plain = false,
  className,
  children,
}: {
  error: unknown
  enabled?: boolean
  onVerified?: () => void
  /** Gives the confirmation a cancel button, when the fields it covers held the form's own. */
  onCancel?: () => void
  /** Drop the confirmation's own panel background, inside a form that already has one. */
  plain?: boolean
  /** Classes for the fields' layer (e.g. the gap the fields had in their form). */
  className?: string
  children: ReactNode
}) {
  const required = useReauthRequired(error, enabled)
  const queryClient = useQueryClient()
  // The confirmation stays in the stack after it is done, so the height does not change back.
  const [shown, setShown] = useState(false)
  const verified = (status: ReauthStatus) => {
    queryClient.setQueryData(accountReauthStatusQueryKey(), status)
    setShown(true)
    if (needsReauth(error)) onVerified?.()
  }

  return (
    <Stack>
      <Layer active={!required} focusOnShow className={className}>
        {children}
      </Layer>
      {required || shown ? (
        <Layer active={required}>
          <ReauthChoice plain={plain} onVerified={verified} onCancel={onCancel} />
        </Layer>
      ) : null}
    </Stack>
  )
}

/** Children share one grid cell: the stack is as tall as its tallest child. */
function Stack({ children }: { children: ReactNode }) {
  return <div className="grid *:col-start-1 *:row-start-1">{children}</div>
}

/** One child of a `Stack`; the hidden ones fade out and cannot be focused or read. */
function Layer({
  active,
  focusOnShow = false,
  className,
  children,
}: {
  active: boolean
  focusOnShow?: boolean
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const wasActive = useRef(active)
  useEffect(() => {
    if (focusOnShow && active && !wasActive.current) {
      ref.current?.querySelector<HTMLElement>('input:not([type=hidden]), button')?.focus()
    }
    wasActive.current = active
  }, [active, focusOnShow])
  return (
    <div
      ref={ref}
      inert={!active}
      aria-hidden={!active || undefined}
      className={cn(
        'flex min-w-0 flex-col transition-opacity duration-200',
        !active && 'pointer-events-none opacity-0',
        className,
      )}
    >
      {children}
    </div>
  )
}

type Step = 'password' | 'email' | 'code'

/**
 * Password, a code emailed to the account, or the linked Google account. Every step is stacked,
 * so switching between them or sending the code keeps the same height.
 */
function ReauthChoice({
  plain,
  onVerified,
  onCancel,
}: {
  plain: boolean
  onVerified: (status: ReauthStatus) => void
  onCancel?: () => void
}) {
  const titleId = useId()
  const passwordId = useId()
  const user = useUser()
  const clientId = useQuery(authConfigOptions()).data?.google_client_id
  const googleLinked = user.identities.some((i) => i.provider === 'google') && Boolean(clientId)
  const [step, setStep] = useState<Step>(user.has_password ? 'password' : 'email')

  const [password, setPassword] = useState('')
  const checkPassword = useMutation({ ...accountReauthPasswordMutation(), onSuccess: onVerified })
  const confirmPassword = () => {
    if (password !== '' && !checkPassword.isPending) checkPassword.mutate({ body: { password } })
  }

  const [resendAt, setResendAt] = useState(0)
  const [code, setCode] = useState('')
  const resendIn = useCountdown(resendAt)
  const sendCode = useMutation({
    ...accountReauthEmailStartMutation(),
    onSuccess: (data) => {
      setResendAt(Date.now() + data.resend_in_seconds * 1000)
      setStep('code')
    },
  })
  const checkCode = useMutation({
    ...accountReauthEmailVerifyMutation(),
    onSuccess: onVerified,
    onError: () => setCode(''),
  })
  const send = () => {
    checkCode.reset()
    sendCode.mutate({})
  }
  const google = useMutation({ ...accountReauthGoogleMutation(), onSuccess: onVerified })

  const errors: Record<Step, unknown> = {
    password: checkPassword.error,
    email: sendCode.error,
    code: checkCode.error ?? sendCode.error,
  }
  const error = google.error ?? errors[step]

  return (
    <FieldSet
      aria-labelledby={titleId}
      className={cn('gap-3', !plain && 'rounded-2xl bg-muted/50 p-4')}
    >
      <div className="flex flex-col gap-1">
        <FieldTitle id={titleId}>{m.auth_reauth_title()}</FieldTitle>
        <FieldDescription>{m.auth_reauth_desc()}</FieldDescription>
      </div>
      <Stack>
        {user.has_password ? (
          <Layer active={step === 'password'} focusOnShow>
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor={passwordId}>{m.auth_reauth_password()}</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id={passwordId}
                  type="password"
                  autoComplete="current-password"
                  ref={focusOnMount}
                  aria-invalid={checkPassword.isError || undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    // The action's own form may be around this field: Enter confirms instead.
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      confirmPassword()
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={password === '' || checkPassword.isPending}
                  onClick={confirmPassword}
                >
                  {m.auth_reauth_confirm()}
                </Button>
              </div>
            </div>
          </Layer>
        ) : null}
        <Layer active={step === 'email'} focusOnShow>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {m.auth_reauth_code_to({ email: user.email })}
            </p>
            <div>
              <Button
                type="button"
                variant="secondary"
                disabled={sendCode.isPending}
                onClick={send}
              >
                {sendCode.isPending ? m.auth_sending() : m.auth_reauth_send_code()}
              </Button>
            </div>
          </div>
        </Layer>
        <Layer active={step === 'code'} focusOnShow>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {m.auth_code_subtitle({ email: user.email })}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <InputOTP
                maxLength={6}
                pattern={REGEXP_ONLY_DIGITS}
                value={code}
                onChange={setCode}
                onComplete={(value) => checkCode.mutate({ body: { code: value } })}
                disabled={checkCode.isPending}
                aria-label={m.auth_code_label()}
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} aria-invalid={checkCode.isError || undefined} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="px-0"
                disabled={resendIn > 0 || sendCode.isPending}
                onClick={send}
              >
                {resendIn > 0 ? m.auth_code_resend_in({ seconds: resendIn }) : m.auth_code_resend()}
              </Button>
            </div>
          </div>
        </Layer>
      </Stack>
      {/* One line is always kept for an error, so showing one does not push anything down. */}
      <FieldError className="min-h-5">{error ? errorMessage(error) : null}</FieldError>
      {user.has_password || googleLinked || onCancel ? (
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
          {user.has_password ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="px-0"
              onClick={() => setStep(step === 'password' ? 'email' : 'password')}
            >
              {step === 'password' ? m.auth_reauth_use_email() : m.auth_reauth_use_password()}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {googleLinked && clientId ? (
              <GoogleSignInButton
                clientId={clientId}
                text="signin_with"
                variant="inline"
                onCredential={(idToken) => google.mutate({ body: { id_token: idToken } })}
              />
            ) : null}
            {onCancel ? (
              <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                {m.common_cancel()}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </FieldSet>
  )
}
