import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { eventsStreamUrl } from '@/lib/api-extras'
import type { QueryKeyPrefix } from './extensions'
import { mergeInvalidations, useModules } from './registry'

/**
 * Live updates (M00 §4.7): the API pushes `{type, data}` over SSE when the user's data changes
 * (another tab, the agent, a background job); matching queries are refetched.
 */

/** Events published by the backend core. Modules declare theirs in their manifest. */
export const coreInvalidations: Record<string, readonly QueryKeyPrefix[]> = {
  'core.job.updated': ['coreJobList', 'coreJobGet'],
}

type Message = { type: string; data: unknown }

function operationId(queryKey: readonly unknown[]): unknown {
  return (queryKey[0] as { _id?: unknown } | undefined)?._id
}

export function connectRealtime(
  queryClient: QueryClient,
  invalidations: Readonly<Record<string, readonly QueryKeyPrefix[]>>,
  url = eventsStreamUrl(),
): () => void {
  const source = new EventSource(url, { withCredentials: true })
  let connectedBefore = false
  source.onopen = () => {
    // Events sent while we were disconnected are lost: refetch everything once.
    if (connectedBefore) void queryClient.invalidateQueries()
    connectedBefore = true
  }
  source.onmessage = (event: MessageEvent<string>) => {
    let message: Message
    try {
      message = JSON.parse(event.data) as Message
    } catch {
      return
    }
    if (message.type === 'core.resync') {
      void queryClient.invalidateQueries()
      return
    }
    const ids = invalidations[message.type]
    if (!ids?.length) return
    void queryClient.invalidateQueries({
      predicate: (query) => ids.includes(operationId(query.queryKey) as string),
    })
  }
  return () => source.close()
}

/** Keeps the SSE connection open while mounted (inside the signed-in layout). */
export function useRealtime() {
  const queryClient = useQueryClient()
  const modules = useModules()
  useEffect(
    () => connectRealtime(queryClient, mergeInvalidations(modules, coreInvalidations)),
    [queryClient, modules],
  )
}
