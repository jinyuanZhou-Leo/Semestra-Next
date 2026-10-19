import { client } from '@semestra/api-client'
import { toApiError } from '@/app/api'

/**
 * Endpoints the generated client does not cover (M00 §4.2): SSE, and later uploads and
 * downloads. Everything else must go through `@semestra/api-client`.
 */
export function apiUrl(path: string): string {
  return `${client.getConfig().baseUrl ?? ''}${path}`
}

export function eventsStreamUrl(): string {
  return apiUrl('/events/stream')
}

type QueryValue = string | number | boolean | readonly string[] | null | undefined

/** `?a=1&b=x&b=y` from a parameter object; arrays repeat the key, empty values are left out. */
export function queryString(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue
    if (Array.isArray(value)) for (const item of value) search.append(key, item)
    else search.append(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

/**
 * A file download from an endpoint outside the OpenAPI schema (e.g. `schedule.export.ics`),
 * with the session cookie. Errors are thrown in the API client's shape.
 */
export async function downloadFile(
  path: string,
  params: Record<string, QueryValue> = {},
): Promise<Blob> {
  const response = await fetch(apiUrl(`${path}${queryString(params)}`), { credentials: 'include' })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined)
    throw toApiError(body, response.status)
  }
  return response.blob()
}

/** Saves a Blob or data URL under `filename` through a temporary link. */
export function saveFile(data: Blob | string, filename: string) {
  const url = typeof data === 'string' ? data : URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  if (typeof data !== 'string') window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
