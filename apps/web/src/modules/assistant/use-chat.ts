import {
  type AgentScope,
  type AgentSessionDetail,
  agentSessionCreate,
  agentSessionStop,
} from '@semestra/api-client'
import { agentSessionGetOptions, agentSessionGetQueryKey } from '@semestra/api-client/react-query'
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { invalidateOperations, toApiError } from '@/app/api'
import { MEMORY_QUERIES } from './memory'
import { type AgentEvent, followAgent, streamAgent } from './stream'
import {
  applyEvent,
  lastTypedUser,
  restartFrom,
  withEditedMessage,
  withUserMessage,
} from './transcript'

export type ChatError = { code: string; params: Record<string, unknown> }

export type SendInput = {
  text: string
  attachmentIds?: string[]
  skill?: { name: string; title: Record<string, string> } | null
  scope?: AgentScope | null
  /** A new conversation that neither reads nor writes memories. */
  temporary?: boolean
}

export type Decision = {
  proposalId: string
  decision: 'approve' | 'reject' | 'edit'
  args?: Record<string, unknown>
  remember?: boolean
  reason?: string
}

const LIST_QUERIES = ['agentSessionList']
const RECONNECT_TRIES = 3
const FOLLOW_AGAIN_MAX = 20 // turns in a row this page follows without a reload

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type OnEvent = (event: AgentEvent) => void
type OnId = (id: string) => void

/**
 * One streaming request; never throws. `started` is false when it failed before the turn. A
 * connection lost mid-turn is picked up again after the last event seen: the turn runs on the
 * server whether or not anyone listens.
 */
async function streamTurn(
  start: (onEvent: OnEvent, onId: OnId) => Promise<unknown>,
  follow: (lastEventId: string | null, onEvent: OnEvent, onId: OnId) => Promise<unknown>,
  handle: OnEvent,
  signal: AbortSignal,
): Promise<{ started: boolean; error: ChatError | null }> {
  let started = false
  let lastId: string | null = null
  const onEvent = (event: AgentEvent) => {
    started = true
    handle(event)
  }
  const onId = (id: string) => {
    started = true
    lastId = id
  }
  try {
    await start(onEvent, onId)
    return { started, error: null }
  } catch (err) {
    if (signal.aborted) return { started, error: null }
    const apiError = toApiError(err)
    if (!started || apiError.status !== 0) {
      return { started, error: { code: apiError.code, params: apiError.params } }
    }
  }
  for (let attempt = 1; attempt <= RECONNECT_TRIES; attempt++) {
    await wait(500 * attempt)
    if (signal.aborted) break
    try {
      await follow(lastId, onEvent, onId)
      return { started, error: null } // Done, or the turn already ended (re-read below).
    } catch {
      // Still offline: try again.
    }
  }
  return { started, error: signal.aborted ? null : { code: 'network', params: {} } }
}

/**
 * Applies events to the conversation's cache entry at most once a frame: a long answer streams
 * many small deltas, and each change re-renders the transcript.
 */
function batcher(apply: (events: AgentEvent[]) => void) {
  let queued: AgentEvent[] = []
  let frame: number | null = null
  const flush = () => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    if (queued.length === 0) return
    const events = queued
    queued = []
    apply(events)
  }
  return {
    push(event: AgentEvent) {
      queued.push(event)
      frame ??= requestAnimationFrame(flush)
    },
    flush,
  }
}

const keyOf = (id: string) => agentSessionGetQueryKey({ path: { id } })

// Conversations whose turn this page already streams: the panel and the full page share the
// cache entry, so only one of them may apply the events.
const streaming = new Set<string>()

/** Applies a turn's events to the conversation; `restart` when following it from its start. */
function eventHandler(
  queryClient: QueryClient,
  id: string,
  restart: boolean,
  setError: (error: ChatError) => void,
) {
  const batch = batcher((events) =>
    queryClient.setQueryData<AgentSessionDetail>(keyOf(id), (current) =>
      current
        ? events.reduce(
            (d, event) =>
              event.event === 'start' && restart
                ? restartFrom(d, event.data.after)
                : applyEvent(d, event),
            current,
          )
        : current,
    ),
  )
  const onEvent = (event: AgentEvent) => {
    if (event.event === 'error') {
      setError(event.data)
      return
    }
    batch.push(event)
    if (event.event === 'title') void invalidateOperations(queryClient, LIST_QUERIES)
    if (event.event === 'tool_result' && event.data.memory) {
      void invalidateOperations(queryClient, MEMORY_QUERIES)
    }
  }
  return { onEvent, flush: batch.flush }
}

/** After a turn: the server copy replaces the streamed one. */
async function settle(queryClient: QueryClient, id: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: keyOf(id) }),
    invalidateOperations(queryClient, LIST_QUERIES),
  ])
}

export function emptyDetail(session: AgentSessionDetail['session']): AgentSessionDetail {
  return { session, messages: [], proposals: [], attachments: [], generating: false }
}

/**
 * The conversation query for every component that shows it: they share one cache entry, and
 * streamed events are applied to it, so none may refetch it on its own while a turn runs.
 */
export function sessionQueryOptions(sessionId: string | null) {
  return {
    ...agentSessionGetOptions({ path: { id: sessionId ?? '' } }),
    enabled: sessionId !== null,
    refetchOnWindowFocus: false,
  }
}

/** Idempotency key of a new conversation. `crypto.randomUUID` needs a secure context, which a
 * LAN address over http is not; `getRandomValues` does not. */
function newClientKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * One conversation: its transcript (the server copy, with streamed events applied as they
 * arrive) and the actions that start a turn. A new conversation is created on the first send.
 */
export function useChat(sessionId: string | null, onCreated: (id: string) => void) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ChatError | null>(null)
  const controller = useRef<AbortController | null>(null)
  // The conversation this hook creates on the first upload or send: one request at a time,
  // and the key makes the server return the same conversation if two get through anyway.
  const creating = useRef<Promise<string> | null>(null)
  const [clientKey] = useState(newClientKey)
  const sending = useRef(false)

  const detail = useQuery({
    ...sessionQueryOptions(sessionId),
    refetchOnWindowFocus: !busy,
  })

  /** Runs one streaming request; false when it failed before the turn started. */
  async function run(id: string, path: string, body: unknown): Promise<boolean> {
    setBusy(true)
    setError(null)
    const abort = new AbortController()
    controller.current = abort
    const { onEvent, flush } = eventHandler(queryClient, id, false, setError)
    streaming.add(id)
    const result = await streamTurn(
      (handle, onId) => streamAgent(path, body, handle, onId, abort.signal),
      (lastId, handle, onId) => followAgent(id, lastId, handle, onId, abort.signal),
      onEvent,
      abort.signal,
    )
    flush()
    streaming.delete(id)
    if (result.error) setError(result.error)
    controller.current = null
    // Not "someone else's turn" for the moment until the server copy is re-read.
    queryClient.setQueryData<AgentSessionDetail>(keyOf(id), (current) =>
      current ? { ...current, generating: false } : current,
    )
    setBusy(false)
    await settle(queryClient, id)
    return result.started
  }

  // A turn this page did not start (another tab, or one running before a reload): follow it.
  const othersTurn = Boolean(detail.data?.generating) && !busy
  useEffect(() => {
    if (!othersTurn || sessionId === null || streaming.has(sessionId)) return
    const abort = new AbortController()
    streaming.add(sessionId)
    const follow = (attempt: number, round = 1): Promise<void> => {
      const { onEvent, flush } = eventHandler(queryClient, sessionId, true, setError)
      return followAgent(sessionId, null, onEvent, () => {}, abort.signal).then(
        async () => {
          flush()
          if (abort.signal.aborted) return
          await settle(queryClient, sessionId)
          // Another turn began as this one ended (a card decided in another tab): follow it
          // too; `othersTurn` stays true, so the effect would not run again by itself.
          const again = queryClient.getQueryData<AgentSessionDetail>(keyOf(sessionId))
          if (again?.generating && round < FOLLOW_AGAIN_MAX) {
            await wait(300)
            if (!abort.signal.aborted) await follow(1, round + 1)
          }
        },
        async (err: unknown) => {
          flush()
          if (abort.signal.aborted) return
          // Offline: try again in a moment, from the start. Anything else (signed out, the
          // conversation deleted) or still offline after a while: show what is stored.
          if (toApiError(err).status !== 0 || attempt >= RECONNECT_TRIES) {
            void settle(queryClient, sessionId)
            return
          }
          await wait(2000)
          if (!abort.signal.aborted) await follow(attempt + 1, round)
        },
      )
    }
    void follow(1).finally(() => {
      if (!abort.signal.aborted) streaming.delete(sessionId)
    })
    return () => {
      abort.abort()
      streaming.delete(sessionId)
    }
  }, [othersTurn, sessionId, queryClient])

  async function createSession(
    scope: AgentScope | null | undefined,
    temporary: boolean,
  ): Promise<string> {
    const { data } = await agentSessionCreate({
      body: {
        ...(scope ? { scope } : {}),
        client_key: clientKey,
        ...(temporary ? { temporary } : {}),
      },
      throwOnError: true,
    })
    queryClient.setQueryData(keyOf(data.id), emptyDetail(data))
    onCreated(data.id)
    return data.id
  }

  function ensureSession(scope: AgentScope | null | undefined, temporary = false): Promise<string> {
    if (sessionId) return Promise.resolve(sessionId)
    if (!creating.current) {
      creating.current = createSession(scope, temporary).catch((err: unknown) => {
        creating.current = null
        throw err
      })
    }
    return creating.current
  }

  async function send(input: SendInput): Promise<boolean> {
    // A second Enter or click before the first send has started its turn.
    if (sending.current) return false
    sending.current = true
    // `.finally` rather than try/finally, which the React Compiler cannot lower.
    return sendOnce(input).finally(() => {
      sending.current = false
    })
  }

  async function sendOnce(input: SendInput): Promise<boolean> {
    setBusy(true)
    const id = await ensureSession(input.scope, input.temporary).catch((err: unknown) => {
      const apiError = toApiError(err)
      setError({ code: apiError.code, params: apiError.params })
      return null
    })
    if (id === null) {
      setBusy(false)
      return false
    }
    const blocks: Record<string, unknown>[] = []
    if (input.skill)
      blocks.push({ type: 'skill', name: input.skill.name, title: input.skill.title })
    if (input.text.trim()) blocks.push({ type: 'text', text: input.text.trim() })
    const attachments = queryClient.getQueryData<AgentSessionDetail>(keyOf(id))?.attachments ?? []
    for (const attId of input.attachmentIds ?? []) {
      const att = attachments.find((a) => a.id === attId)
      blocks.push({
        type: att?.kind === 'image' ? 'image_ref' : 'file_ref',
        attachment_id: attId,
        name: att?.name ?? '',
      })
    }
    queryClient.setQueryData<AgentSessionDetail>(keyOf(id), (current) =>
      current ? withUserMessage(current, `pending-${Date.now()}`, blocks) : current,
    )
    return run(id, `/agent/sessions/${id}/messages`, {
      text: input.text,
      attachment_ids: input.attachmentIds ?? [],
      scope: input.scope ?? null,
      skill: input.skill?.name ?? null,
    })
  }

  function decide(decisions: Decision[]) {
    if (!sessionId || decisions.length === 0) return Promise.resolve(false)
    const body = (d: Decision) => ({
      decision: d.decision,
      args: d.args ?? null,
      remember: d.remember ?? false,
      reason: d.reason ?? null,
    })
    const [first] = decisions
    if (decisions.length === 1 && first) {
      return run(
        sessionId,
        `/agent/sessions/${sessionId}/proposals/${first.proposalId}:decide`,
        body(first),
      )
    }
    return run(sessionId, `/agent/sessions/${sessionId}/proposals:decide`, {
      decisions: decisions.map((d) => ({ proposal_id: d.proposalId, ...body(d) })),
    })
  }

  function regenerate(messageId: string) {
    if (!sessionId) return Promise.resolve(false)
    queryClient.setQueryData<AgentSessionDetail>(keyOf(sessionId), (current) => {
      if (!current) return current
      const lastUser = lastTypedUser(current.messages)
      return {
        ...current,
        messages: current.messages.slice(0, lastUser + 1),
        regenerable: null,
      }
    })
    return run(sessionId, `/agent/sessions/${sessionId}/messages/${messageId}:regenerate`, {})
  }

  /** Picks a paused turn up again, with a fresh tool-call budget. */
  function resume() {
    if (!sessionId) return Promise.resolve(false)
    return run(sessionId, `/agent/sessions/${sessionId}:continue`, {})
  }

  /** Replaces the text of a sent message; everything after it is dropped and answered again. */
  function edit(messageId: string, text: string) {
    if (!sessionId) return Promise.resolve(false)
    queryClient.setQueryData<AgentSessionDetail>(keyOf(sessionId), (current) =>
      current ? withEditedMessage(current, messageId, text.trim()) : current,
    )
    return run(sessionId, `/agent/sessions/${sessionId}/messages/${messageId}:edit`, { text })
  }

  async function stop() {
    if (!sessionId) return
    try {
      await agentSessionStop({ path: { id: sessionId }, throwOnError: true })
    } catch {
      // The server is not answering here (e.g. it already finished): drop the stream.
      controller.current?.abort()
    }
  }

  const generating = busy || Boolean(detail.data?.generating)
  return {
    detail: detail.data,
    loading: sessionId !== null && detail.isPending,
    loadError: detail.error,
    busy,
    generating,
    error,
    clearError: () => setError(null),
    ensureSession,
    send,
    decide,
    regenerate,
    resume,
    edit,
    stop,
  }
}
