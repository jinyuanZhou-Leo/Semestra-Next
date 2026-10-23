import { useId } from 'react'
import { toApiError } from '@/app/api'
import { useAuth } from '@/modules/auth/useAuth'
import { errorCode, errorMessage } from '@/lib/errors'
import { m } from '@/paraglide/messages'
import { Button } from '@/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/field'
import { Input } from '@/ui/input'

/**
 * How a sensitive action's error relates to re-authentication (M01 §4.5): the server asks for
 * the password (or a fresh sign-in, for accounts without one) when the session is older than
 * 10 minutes. `handled` errors are shown by `ReauthFields`; show the rest yourself.
 */
export function reauthState(error: unknown) {
  const code = error ? errorCode(error) : null
  const reauth = code === 'auth.reauth_required'
  const needsPassword = reauth && Boolean(toApiError(error).params.password)
  const passwordWrong = code === 'auth.invalid_credentials'
  return { needsPassword, passwordWrong, handled: reauth || passwordWrong }
}

/** The password field or "sign in again" prompt that follows a re-authentication error. */
export function ReauthFields({
  error,
  password,
  onPasswordChange,
}: {
  error: unknown
  password: string
  onPasswordChange: (password: string) => void
}) {
  const id = useId()
  const { signOut } = useAuth()
  const { needsPassword, passwordWrong, handled } = reauthState(error)
  if (needsPassword || passwordWrong) {
    return (
      <Field data-invalid={passwordWrong || undefined}>
        <FieldLabel htmlFor={id}>{m.auth_reauth_password()}</FieldLabel>
        <Input
          id={id}
          type="password"
          autoComplete="current-password"
          aria-invalid={passwordWrong || undefined}
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
        />
        {passwordWrong ? (
          <FieldError>{errorMessage(error)}</FieldError>
        ) : (
          <FieldDescription>{m.auth_reauth_password_desc()}</FieldDescription>
        )}
      </Field>
    )
  }
  if (!handled) return null
  return (
    <Field>
      <FieldError>{m.auth_reauth_sign_in()}</FieldError>
      <Button variant="outline" size="sm" className="self-start" onClick={() => void signOut()}>
        {m.auth_reauth_sign_in_again()}
      </Button>
    </Field>
  )
}
