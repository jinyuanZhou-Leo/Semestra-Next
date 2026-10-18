import { client } from '@semestra/api-client'

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
