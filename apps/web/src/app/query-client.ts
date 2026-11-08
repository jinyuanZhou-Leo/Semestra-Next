import type { DefaultOptions } from '@tanstack/react-query'

/**
 * Query defaults for the app (and the tests). Changes made elsewhere (another tab, the agent, a
 * job) arrive over SSE and refetch what they touch (app/realtime.ts), so data a page just loaded
 * or prefetched is not fetched again on mount, nor when the window regains focus (M00 §4.7). Data
 * that changes without an event (AI usage, say) sets `refetchOnMount: 'always'` and
 * `refetchOnWindowFocus: true`.
 */
export const QUERY_DEFAULTS = {
  queries: { staleTime: 30_000, refetchOnWindowFocus: false },
} satisfies DefaultOptions
