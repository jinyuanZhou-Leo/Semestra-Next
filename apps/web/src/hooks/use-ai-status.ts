import type { PurposeStatus } from '@semestra/api-client'
import { aiStatusGetOptions } from '@semestra/api-client/react-query'
import { useQuery } from '@tanstack/react-query'

export type AiPurpose = PurposeStatus['purpose']

export const AI_PURPOSES: readonly AiPurpose[] = [
  'chat',
  'extraction',
  'vision',
  'ocr',
  'embedding',
  'title',
]

export type AiStatusGetResult = {
  /** True once the server says a model serves this purpose. */
  available: boolean
  /** Still loading: treat the feature as unavailable but say nothing yet. */
  pending: boolean
  status: PurposeStatus | undefined
}

/** The AI status query; the signed-in layout prefetches it so AI entry points rarely wait. */
export function aiStatusOptions() {
  return { ...aiStatusGetOptions(), staleTime: 60_000 }
}

/** Whether AI features that need `purpose` can run now (M06 §7). Updates live via SSE. */
export function useAiStatus(purpose: AiPurpose): AiStatusGetResult {
  const query = useQuery(aiStatusOptions())
  const status = query.data?.items.find((item) => item.purpose === purpose)
  return { available: status?.available ?? false, pending: query.isPending, status }
}
