import {
  aiAssignmentGetOptions,
  aiProviderListModelsOptions,
  aiProviderListOptions,
  aiUsageSummarizeOptions,
  filesOutdatedCountOptions,
} from '@semestra/api-client/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { readUiPref } from '@/app/ui-pref'
import { aiStatusOptions } from '@/hooks/use-ai-status'

/** Generated query ids that show AI configuration; refetched after any change (and via SSE). */
export const AI_QUERIES = [
  'aiStatusGet',
  'aiProviderList',
  'aiAssignmentGet',
  'aiProviderListModels',
]

export function invalidateAi(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      // oxlint-disable-next-line no-underscore-dangle -- hey-api's query key field
      const id = (query.queryKey[0] as { _id?: unknown } | undefined)?._id
      return typeof id === 'string' && AI_QUERIES.includes(id)
    },
  })
}

/** The usage page's range: today, the last 7 or 30 days, or all time (UI state `ai.usage_range`). */
export type UsageRange = '1' | '7' | '30' | 'all'

export const USAGE_RANGE_KEY = 'ai.usage_range'
export const DEFAULT_USAGE_RANGE: UsageRange = '30'

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** Usage over `range`, in days of the browser's time zone. */
export function usageOptions(range: UsageRange) {
  return aiUsageSummarizeOptions({
    query: { ...(range === 'all' ? {} : { days: Number(range) }), tz: browserTimeZone() },
  })
}

/** `prefetch` of the AI settings sections (M11 §5.2). */
export const settingsPrefetch = {
  status: (_scope: unknown, queryClient: QueryClient) =>
    queryClient.ensureQueryData(aiStatusOptions()),
  providers: (_scope: unknown, queryClient: QueryClient) =>
    queryClient.ensureQueryData(aiProviderListOptions()),
  // The boxes name each model as its provider's list does.
  models: (_scope: unknown, queryClient: QueryClient) =>
    Promise.all([
      queryClient.ensureQueryData(aiAssignmentGetOptions()),
      queryClient.ensureQueryData(aiStatusOptions()),
      // The row under OCR for PDFs read by an earlier version.
      queryClient.ensureQueryData(filesOutdatedCountOptions()),
      queryClient.ensureQueryData(aiProviderListOptions()).then((providers) =>
        Promise.all(
          providers.items
            .filter((provider) => provider.enabled)
            .map((provider) =>
              queryClient.ensureQueryData({
                ...aiProviderListModelsOptions({ path: { id: provider.id } }),
                retry: false,
              }),
            ),
        ),
      ),
    ]),
  usage: async (_scope: unknown, queryClient: QueryClient) => {
    const range = await readUiPref<UsageRange>(queryClient, USAGE_RANGE_KEY)
    return queryClient.ensureQueryData(usageOptions(range ?? DEFAULT_USAGE_RANGE))
  },
}
