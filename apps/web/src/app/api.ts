import { client } from '@semestra/api-client'

client.setConfig({
  baseUrl: import.meta.env.VITE_API_ORIGIN ?? 'http://localhost:8000',
  credentials: 'include',
})

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, unknown>,
    readonly status: number,
  ) {
    super(code)
  }
}

/** Backend errors are `{ error: { code, params, request_id } }`; translate by `error_<code>`. */
export function toApiError(err: unknown, status = 0): ApiError {
  const body = (err as { error?: { code?: string; params?: Record<string, unknown> } } | undefined)
    ?.error
  return new ApiError(body?.code ?? 'unknown', body?.params ?? {}, status)
}
