import type { JobOut, JobPage } from '@semestra/api-client'
import { type Query, type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { eventsStreamUrl } from '@/lib/api-extras'
import type { QueryKeyPrefix } from './extensions'
import { mergeInvalidations, useModules } from './registry'

/**
 * Live updates (M00 §4.7): the API pushes `{type, data}` over SSE when the user's data changes
 * (another tab, the agent, a background job); matching queries are refetched.
 */

export const JOB_PROGRESS = 'core.job.progress'

type Message = { type: string; data: unknown }

type JobProgressEvent = Pick<
  JobOut,
  'kind' | 'status' | 'progress' | 'step' | 'step_current' | 'step_total'
> & {
  job_id: string
}

type KeyHead = { _id?: unknown; path?: { job_id?: unknown } }

function keyHead(queryKey: readonly unknown[]): KeyHead {
  return (queryKey[0] as KeyHead | undefined) ?? {}
}

function operationId(queryKey: readonly unknown[]): unknown {
  // oxlint-disable-next-line no-underscore-dangle -- hey-api's query key field
  return keyHead(queryKey)._id
}

const FINISHED = new Set(['succeeded', 'failed', 'cancelled'])

/**
 * Progress events patch cached jobs in place, so a bar moves without a refetch per tick. Changes
 * the event cannot express (a job new to a list, a new status, the result) refetch instead.
 */
function applyJobProgress(queryClient: QueryClient, event: JobProgressEvent) {
  const { job_id: id, ...fields } = event
  let refetch = FINISHED.has(event.status)
  const patch = (job: JobOut): JobOut => {
    if (job.id !== id) return job
    if (job.status !== event.status) refetch = true
    return { ...job, ...fields }
  }
  const isList = (q: Query) => operationId(q.queryKey) === 'coreJobList'
  const isThisJob = (q: Query) =>
    operationId(q.queryKey) === 'coreJobGet' && keyHead(q.queryKey).path?.job_id === id
  let listed = false
  queryClient.setQueriesData<JobPage>({ predicate: isList }, (page) => {
    if (!page) return page
    listed ||= page.items.some((job) => job.id === id)
    return { ...page, items: page.items.map(patch) }
  })
  queryClient.setQueriesData<JobOut>({ predicate: isThisJob }, (job) => job && patch(job))
  if (refetch || !listed) void queryClient.invalidateQueries({ predicate: isList })
  if (refetch) void queryClient.invalidateQueries({ predicate: isThisJob })
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
    if (message.type === JOB_PROGRESS)
      applyJobProgress(queryClient, message.data as JobProgressEvent)
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
  useEffect(() => connectRealtime(queryClient, mergeInvalidations(modules)), [queryClient, modules])
}
