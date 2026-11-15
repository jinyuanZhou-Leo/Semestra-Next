import googleLogo from '@lobehub/icons-static-svg/icons/google.svg?url'
import {
  accountReauthPasskey,
  accountReauthPasskeyOptions,
  type ReauthStatus,
} from '@semestra/api-client'
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
import { ChevronDown, KeyRound, LockKeyhole, Mail } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { BrandLogo } from '@/components/BrandLogo'
import { useNow } from '@/hooks/use-now'
import { errorCode, errorMessage } from '@/lib/errors'
import { focusOnMount } from '@/lib/focus'
import { cn } from '@/lib/utils'
import { getPasskey, passkeyCancelled, passkeysSupported } from '@/modules/auth/passkey'
import { useUser } from '@/modules/auth/useAuth'
import { UserAvatar } from '@/modules/auth/settings/UserAvatar'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { FieldDescription, FieldError, FieldSet, FieldTitle } from '@/ui/field'
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
  // An answer newer than the last tick counts as now: "0 seconds left" asks at once.
  const due = until !== null && Math.max(now, status.dataUpdatedAt) >= until
  return needsReauth(error) || (enabled && due)
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
  // Each time it is needed again it starts afresh (no old code, password or "sent").
  const [round, setRound] = useState(0)
  const [wasRequired, setWasRequired] = useState(required)
  if (required !== wasRequired) {
    setWasRequired(required)
    if (required) setRound(round + 1)
  }
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
          <ReauthChoice key={round} plain={plain} onVerified={verified} onCancel={onCancel} />
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

type Way = 'passkey' | 'password' | 'google' | 'email'

const WAY_ICONS: Record<Way, ReactNode> = {
  passkey: <KeyRound aria-hidden />,
  password: <LockKeyhole aria-hidden />,
  google: <BrandLogo src={googleLogo} />,
  email: <Mail aria-hidden />,
}

function wayLabel(way: Way): string {
  return {
    passkey: m.auth_reauth_way_passkey,
    password: m.auth_reauth_way_password,
    google: m.auth_reauth_way_google,
    email: m.auth_reauth_way_email,
  }[way]()
}

/**
 * One way at a time (M01 §4.7): the account's preferred one first (passkey, password, Google,
 * then an emailed code, which every account has), the others behind "Use another way". Every
 * way is stacked in the same cell, so switching or sending the code keeps the same height.
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
  const user = useUser()
  const clientId = useQuery(authConfigOptions()).data?.google_client_id
  const ways: Way[] = [
    ...(user.has_passkey && passkeysSupported() ? (['passkey'] as const) : []),
    ...(user.has_password ? (['password'] as const) : []),
    ...(user.identities.some((i) => i.provider === 'google') && clientId
      ? (['google'] as const)
      : []),
    'email',
  ]
  const [chosen, setChosen] = useState<Way>(ways[0] ?? 'email')
  const way = ways.includes(chosen) ? chosen : 'email'

  const [password, setPassword] = useState('')
  const checkPassword = useMutation({ ...accountReauthPasswordMutation(), onSuccess: onVerified })
  const confirmPassword = () => {
    if (password !== '' && !checkPassword.isPending) checkPassword.mutate({ body: { password } })
  }

  const [resendAt, setResendAt] = useState(0)
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const resendIn = useCountdown(resendAt)
  const sendCode = useMutation({
    ...accountReauthEmailStartMutation(),
    onSuccess: (data) => {
      setResendAt(Date.now() + data.resend_in_seconds * 1000)
      setCodeSent(true)
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
  const passkey = useMutation({
    mutationFn: async () => {
      const { data: options } = await accountReauthPasskeyOptions({ throwOnError: true })
      const credential = await getPasskey(options)
      const { data } = await accountReauthPasskey({ body: { credential }, throwOnError: true })
      return data
    },
    onSuccess: onVerified,
  })

  const errors: Record<Way, unknown> = {
    passkey: passkeyCancelled(passkey.error) ? null : passkey.error,
    password: checkPassword.error,
    google: google.error,
    email: checkCode.error ?? sendCode.error,
  }
  const error = errors[way]
  const choose = (next: Way) => {
    setChosen(next)
    passkey.reset()
  }

  return (
    <FieldSet
      aria-labelledby={titleId}
      className={cn('gap-4', !plain && 'rounded-2xl bg-muted/50 p-4')}
    >
      <div className="flex items-center gap-3">
        <UserAvatar name={user.display_name} src={user.avatar_url} />
        <div className="min-w-0">
          <FieldTitle id={titleId}>{m.auth_reauth_title()}</FieldTitle>
          <FieldDescription className="truncate">{user.email}</FieldDescription>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Stack>
          <Layer active={way === 'passkey'} focusOnShow>
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={passkey.isPending}
              onClick={() => passkey.mutate()}
            >
              <KeyRound aria-hidden />
              {m.auth_reauth_passkey()}
            </Button>
          </Layer>
          {user.has_password ? (
            <Layer active={way === 'password'} focusOnShow>
              <div className="flex gap-2">
                <Input
                  type="password"
                  autoComplete="current-password"
                  aria-label={m.auth_reauth_password()}
                  placeholder={m.auth_reauth_password()}
                  className="h-10"
                  ref={way === 'password' ? focusOnMount : undefined}
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
                  size="lg"
                  disabled={password === '' || checkPassword.isPending}
                  onClick={confirmPassword}
                >
                  {m.auth_reauth_confirm()}
                </Button>
              </div>
            </Layer>
          ) : null}
          {ways.includes('google') && clientId ? (
            <Layer active={way === 'google'}>
              <GoogleSignInButton
                clientId={clientId}
                onCredential={(idToken) => google.mutate({ body: { id_token: idToken } })}
              />
            </Layer>
          ) : null}
          <Layer active={way === 'email' && !codeSent} focusOnShow>
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={sendCode.isPending}
              onClick={send}
            >
              {sendCode.isPending ? m.auth_sending() : m.auth_reauth_send_code()}
            </Button>
          </Layer>
          <Layer active={way === 'email' && codeSent} focusOnShow>
            <InputOTP
              maxLength={6}
              pattern={REGEXP_ONLY_DIGITS}
              value={code}
              onChange={setCode}
              onComplete={(value) => checkCode.mutate({ body: { code: value } })}
              disabled={checkCode.isPending}
              aria-label={m.auth_code_label()}
              containerClassName="h-10 justify-center"
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} aria-invalid={checkCode.isError || undefined} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </Layer>
        </Stack>
        {/* One line is always kept under the way: a hint, or the error in its place. */}
        <div aria-live="polite" className="min-h-5 text-center">
          {error ? (
            <FieldError>{errorMessage(error)}</FieldError>
          ) : way === 'email' && codeSent ? (
            <p className="text-xs text-muted-foreground">
              {m.auth_reauth_code_sent()}
              {' · '}
              <Button
                type="button"
                variant="link"
                size="xs"
                className="h-auto px-0 text-xs"
                disabled={resendIn > 0 || sendCode.isPending}
                onClick={send}
              >
                {resendIn > 0 ? m.auth_code_resend_in({ seconds: resendIn }) : m.auth_code_resend()}
              </Button>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {way === 'email'
                ? m.auth_reauth_code_to({ email: user.email })
                : m.auth_reauth_window()}
            </p>
          )}
        </div>
      </div>
      {ways.length > 1 || onCancel ? (
        <div
          className={cn(
            'flex min-h-8 items-center gap-2',
            onCancel ? 'justify-between' : 'justify-center',
          )}
        >
          {ways.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                  />
                }
              >
                {m.auth_reauth_other_way()}
                <ChevronDown aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align={onCancel ? 'start' : 'center'} className="w-48">
                {ways
                  .filter((w) => w !== way)
                  .map((w) => (
                    <DropdownMenuItem key={w} onClick={() => choose(w)}>
                      {WAY_ICONS[w]}
                      {wayLabel(w)}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span />
          )}
          {onCancel ? (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              {m.common_cancel()}
            </Button>
          ) : null}
        </div>
      ) : null}
    </FieldSet>
  )
}
