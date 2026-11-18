import { errorCode, errorMessage } from '@/lib/errors'
import { toApiError } from '@/app/api'
import { m } from '@/paraglide/messages'

/**
 * The line shown under a new-password field when the server rejected it as too weak (M01 §4.6),
 * naming the rule it broke; `null` for any other error, which belongs under the form instead.
 */
export function weakPasswordError(error: unknown): string | null {
  if (!error || errorCode(error) !== 'auth.weak_password') return null
  const { reasons, min_length } = toApiError(error).params as {
    reasons?: string[]
    min_length?: number
  }
  switch (reasons?.[0]) {
    case 'too_short':
      return m.auth_password_too_short({ min: min_length ?? 8 })
    case 'same_as_email':
      return m.auth_password_same_as_email()
    case 'too_common':
      return m.auth_password_too_common()
    default:
      return errorMessage(error)
  }
}
