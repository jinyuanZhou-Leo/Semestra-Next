import { toast } from 'sonner'
import { toApiError } from '@/app/api'
import * as m from '@/paraglide/messages'

type MessageFn = (params?: Record<string, unknown>) => string
const messages = m as unknown as Record<string, MessageFn | undefined>

/** Translated, user-facing text for any error thrown by the API client. */
export function errorMessage(err: unknown): string {
  const apiError = toApiError(err)
  const key = `error_${apiError.code.replaceAll('.', '_')}`
  const fn = messages[key] ?? messages.error_unknown
  return fn?.(apiError.params) ?? 'Error'
}

export function errorCode(err: unknown): string {
  return toApiError(err).code
}

export function toastError(err: unknown) {
  toast.error(errorMessage(err))
}
