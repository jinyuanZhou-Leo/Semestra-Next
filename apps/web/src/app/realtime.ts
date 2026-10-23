import type { JobOut, JobPage } from '@semestra/api-client'
import {
  partialMatchKey,
  type Query,
  type QueryClient,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { eventsStreamUrl } from '@/lib/api-extras'
import { CLIENT_ID } from './api'
import type { InvalidationTarget, QueryMatch } from './extensions'
import { mergeInvalidations, mergeSkipOwn, useModules } from './registry'

/**
 * Live updates (M00 §4.7): the API pushes `{type, data, origin?}` over SSE when the user's data
 * changes (another tab, the agent, a background job); matching queries are refetched.
 */

export const JOB_PROGRESS = 'core.job.progress'

type Message = { type: string; data: unknown; origin?: string }

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

/** Events arriving this close together are applied with one refetch per query. */
export const COALESCE_MS = 50

type Pending = { all: boolean; operations: Set<string>; matches: QueryMatch[] }

function collect(
  pending: Pending,
  targets: readonly InvalidationTarget[],
  data: Readonly<Record<string, unknown>>,
) {
  for (const target of targets) {
    for (const item of typeof target === 'function' ? target(data) : [target]) {
      if (typeof item === 'string') pending.operations.add(item)
      else pending.matches.push(item)
    }
  }
}

function invalidate(queryClient: QueryClient, pending: Pending) {
  // `cancelRefetch: false`: a request already on its way (a mutation's own refetch, say) is
  // kept instead of being cancelled and sent again.
  if (pending.all) {
    void queryClient.invalidateQueries(undefined, { cancelRefetch: false })
    return
  }
  if (!pending.operations.size && !pending.matches.length) return
  void queryClient.invalidateQueries(
    {
      predicate: (query) =>
        pending.operations.has(operationId(query.queryKey) as string) ||
        pending.matches.some((match) => partialMatchKey(query.queryKey, [match])),
    },
    { cancelRefetch: false },
  )
}

export type RealtimeConfig = {
  invalidations: Readonly<Record<string, readonly InvalidationTarget[]>>
  /** Event types skipped when this tab caused them (`ModuleManifest.realtimeSkipOwn`). */
  skipOwn?: ReadonlySet<string>
}

/**
 * Opens the SSE connection. `config` is read when each event arrives, so it may change (a
 * plugin installed) without reconnecting. A burst of events (deleting a course sends several)
 * is coalesced into one refetch. The server replays what a reconnecting stream missed, or sends
 * `core.resync` when it cannot, so a reconnect itself refetches nothing.
 */
export function connectRealtime(
  queryClient: QueryClient,
  config: RealtimeConfig | (() => RealtimeConfig),
  url = eventsStreamUrl(),
): () => void {
  const read = typeof config === 'function' ? config : () => config
  const source = new EventSource(url, { withCredentials: true })
  let pending: Pending = { all: false, operations: new Set(), matches: [] }
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    timer = undefined
    const batch = pending
    pending = { all: false, operations: new Set(), matches: [] }
    invalidate(queryClient, batch)
  }
  source.onmessage = (event: MessageEvent<string>) => {
    let message: Message
    try {
      message = JSON.parse(event.data) as Message
    } catch {
      return
    }
    if (message.type === 'core.resync') {
      pending.all = true
    } else {
      if (message.type === JOB_PROGRESS)
        applyJobProgress(queryClient, message.data as JobProgressEvent)
      const { invalidations, skipOwn } = read()
      const targets = invalidations[message.type]
      if (!targets?.length) return
      if (message.origin === CLIENT_ID && skipOwn?.has(message.type)) return
      collect(pending, targets, (message.data ?? {}) as Record<string, unknown>)
    }
    timer ??= setTimeout(flush, COALESCE_MS)
  }
  return () => {
    if (timer !== undefined) clearTimeout(timer)
    source.close()
  }
}

/** Keeps the SSE connection open while mounted (inside the signed-in layout). */
export function useRealtime() {
  const queryClient = useQueryClient()
  const modules = useModules()
  const config = useRef<RealtimeConfig>({ invalidations: {} })
  useEffect(() => {
    config.current = { invalidations: mergeInvalidations(modules), skipOwn: mergeSkipOwn(modules) }
  }, [modules])
  // One connection for the session: installing a plugin only changes what events refetch.
  useEffect(() => connectRealtime(queryClient, () => config.current), [queryClient])
}
