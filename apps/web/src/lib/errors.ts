import { toast } from 'sonner'
import { toApiError } from '@/app/api'
import * as m from '@/paraglide/messages'

type MessageFn = (params?: Record<string, unknown>) => string
const messages = m as unknown as Record<string, MessageFn | undefined>

function translateCode(code: string, params: Record<string, unknown>): string {
  const fn = messages[`error_${code.replaceAll('.', '_')}`] ?? messages.error_unknown
  return fn?.(params) ?? 'Error'
}

/**
 * Translated, user-facing text for any error thrown by the API client. A `reason` param that is
 * itself an error code (e.g. `ai.provider_check_failed` → `ai.invalid_key`) is translated too.
 */
export function errorMessage(err: unknown): string {
  const apiError = toApiError(err)
  const params = { ...apiError.params }
  if (typeof params.reason === 'string' && params.reason.includes('.')) {
    params.reason = translateCode(params.reason, {})
  }
  return translateCode(apiError.code, params)
}

export function errorCode(err: unknown): string {
  return toApiError(err).code
}

export function toastError(err: unknown) {
  toast.error(errorMessage(err))
}
