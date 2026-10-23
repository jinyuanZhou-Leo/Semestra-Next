import { client } from '@semestra/api-client'
import type { QueryClient } from '@tanstack/react-query'
import { isReauthPending, isSignedIn, requestReauth } from './session-expiry'

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
  if (err instanceof ApiError) return err
  const body = (err as { error?: { code?: string; params?: Record<string, unknown> } } | undefined)
    ?.error
  return new ApiError(
    body?.code ?? (status === 0 ? 'network' : 'unknown'),
    body?.params ?? {},
    status,
  )
}

const CSRF_COOKIE = 'semestra_csrf'
const CSRF_HEADER = 'X-Semestra-CSRF'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function readCookie(name: string): string | undefined {
  for (const part of document.cookie.split('; ')) {
    const [key, ...value] = part.split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return undefined
}

function withCsrf(request: Request): Request {
  const token = readCookie(CSRF_COOKIE)
  if (token && !SAFE_METHODS.has(request.method)) request.headers.set(CSRF_HEADER, token)
  return request
}

/** The CSRF header for requests made outside the generated client (an SSE POST). */
export function csrfHeaders(): Record<string, string> {
  const token = readCookie(CSRF_COOKIE)
  return token ? { [CSRF_HEADER]: token } : {}
}

// An unconsumed copy of every request, so a 401 can be retried after re-login.
const SESSION_LAPSED = new Set(['common.unauthenticated', 'auth.session_expired'])

const backups = new WeakMap<Request, Request>()

/**
 * This tab's id, sent with every request (`X-Semestra-Client`). Events a request causes carry it
 * back as `origin`, so the tab can skip the echo of its own change (`app/realtime.ts`).
 */
export const CLIENT_ID = crypto.randomUUID()

client.interceptors.request.use((request) => {
  request.headers.set('X-Semestra-Client', CLIENT_ID)
  backups.set(request, request.clone())
  return withCsrf(request)
})

type ErrorBody = { error?: { code?: string } } | null

/**
 * Whether this response means the session lapsed and the user signed in again, so the request
 * can be sent once more. Only a lapsed session asks for re-login: other 401s (e.g. a wrong current
 * password while changing it) are ordinary errors the page shows itself.
 */
async function reauthenticated(status: number, url: string, body: ErrorBody): Promise<boolean> {
  const isAuthRoute = new URL(url, window.location.href).pathname.startsWith('/auth/')
  if (status !== 401 || isAuthRoute || !(isSignedIn() || isReauthPending())) return false
  if (!SESSION_LAPSED.has(body?.error?.code ?? '')) return false
  return requestReauth()
}

client.interceptors.response.use(async (response, request) => {
  if (response.status !== 401) return response
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as ErrorBody
  const backup = backups.get(request)
  if (!backup || !(await reauthenticated(response.status, request.url, body))) return response
  return fetch(withCsrf(backup), { credentials: 'include' })
})

client.interceptors.error.use((error, response) => toApiError(error, response?.status ?? 0))

/** Refetches every cached query of these generated operations (e.g. `['layoutsBoardGet']`). */
export function invalidateOperations(queryClient: QueryClient, operationIds: readonly string[]) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const head = query.queryKey[0] as { _id?: unknown } | undefined
      // oxlint-disable-next-line no-underscore-dangle -- hey-api's query key field
      return operationIds.includes(head?._id as string)
    },
  })
}

type ProgressOptions = { signal?: AbortSignal; onProgress?: (loaded: number) => void }

/**
 * A multipart POST with real byte progress, which `fetch` cannot report (file uploads). Stays
 * outside the generated client, so it adds the CSRF header itself and, like the client, sends
 * the upload again after a lapsed session is signed back in; errors are `ApiError`s.
 */
export async function postWithProgress<T>(
  path: string,
  form: FormData,
  options: ProgressOptions = {},
): Promise<T> {
  const url = `${client.getConfig().baseUrl ?? ''}${path}`
  const first = await sendWithProgress(url, form, options)
  const done = (await reauthenticated(first.status, url, first.body as ErrorBody))
    ? await sendWithProgress(url, form, options)
    : first
  if (done.status >= 200 && done.status < 300) return done.body as T
  throw toApiError(done.body, done.status)
}

function sendWithProgress(
  url: string,
  form: FormData,
  { signal, onProgress }: ProgressOptions,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', url)
    request.withCredentials = true
    for (const [name, value] of Object.entries(csrfHeaders())) request.setRequestHeader(name, value)
    if (onProgress) request.upload.onprogress = (event) => onProgress(event.loaded)
    request.onload = () => {
      let body: unknown = null
      try {
        body = JSON.parse(request.responseText)
      } catch {
        // not JSON: handled as an unknown error below
      }
      resolve({ status: request.status, body })
    }
    request.onerror = () => reject(toApiError(null))
    request.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal?.addEventListener('abort', () => request.abort(), { once: true })
    request.send(form)
  })
}
