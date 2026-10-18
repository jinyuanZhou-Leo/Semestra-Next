import type { PurposeStatus } from '@semestra/api-client'
import { aiStatusOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'

export type AiPurpose = PurposeStatus['purpose']

export const AI_PURPOSES: readonly AiPurpose[] = [
  'chat',
  'extraction',
  'vision',
  'embedding',
  'title',
]

/** Where the "connect AI" hints link to: the AI section of the account settings. */
export const AI_SETTINGS_LINK = {
  to: '/settings/$group',
  params: { group: 'features' },
  hash: 'ai-providers',
} as const

export type AiStatusResult = {
  /** True once the server says a model serves this purpose. */
  available: boolean
  /** Still loading: treat the feature as unavailable but say nothing yet. */
  pending: boolean
  status: PurposeStatus | undefined
}

/** Whether AI features that need `purpose` can run now (M06 §7). Updates live via SSE. */
export function useAiStatus(purpose: AiPurpose): AiStatusResult {
  const query = useQuery({ ...aiStatusOptions(), staleTime: 60_000 })
  const status = query.data?.items.find((item) => item.purpose === purpose)
  return { available: status?.available ?? false, pending: query.isPending, status }
}
