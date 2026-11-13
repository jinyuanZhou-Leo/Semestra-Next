import type { DefaultOptions } from '@tanstack/react-query'
import { ApiError } from './api'

/**
 * Up to three retries for what may pass on its own (no connection, a server error, too many
 * requests). A request the server refused (not found, forbidden, invalid) fails at once: asking
 * again gives the same answer, and a page about something just deleted would wait seconds.
 */
function retryable(failureCount: number, error: unknown): boolean {
  const status = error instanceof ApiError ? error.status : 0
  return failureCount < 3 && (status < 400 || status >= 500 || status === 408 || status === 429)
}

/**
 * Query defaults for the app (and the tests). Changes made elsewhere (another tab, the agent, a
 * job) arrive over SSE and refetch what they touch (app/realtime.ts), so data a page just loaded
 * or prefetched is not fetched again on mount, nor when the window regains focus (M00 §4.7). Data
 * that changes without an event (AI usage, say) sets `refetchOnMount: 'always'` and
 * `refetchOnWindowFocus: true`.
 */
export const QUERY_DEFAULTS = {
  queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: retryable },
} satisfies DefaultOptions
