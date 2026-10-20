import {
  type AgentScope,
  type AgentSessionDetail,
  agentSessionCreate,
  agentSessionStop,
} from '@semestra/api-client'
import { agentSessionGetOptions, agentSessionGetQueryKey } from '@semestra/api-client/react-query'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { invalidateOperations, toApiError } from '@/app/api'
import { type AgentEvent, streamAgent } from './stream'
import { applyEvent, withEditedMessage, withUserMessage } from './transcript'

export type ChatError = { code: string; params: Record<string, unknown> }

export type SendInput = {
  text: string
  attachmentIds?: string[]
  skill?: { name: string; title: Record<string, string> } | null
  scope?: AgentScope | null
}

export type Decision = {
  proposalId: string
  decision: 'approve' | 'reject' | 'edit'
  args?: Record<string, unknown>
  remember?: boolean
  reason?: string
}

const LIST_QUERIES = ['agentSessionList']

/** One streaming request; never throws. `started` is false when it failed before the turn. */
async function streamTurn(
  path: string,
  body: unknown,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<{ started: boolean; error: ChatError | null }> {
  let started = false
  try {
    await streamAgent(
      path,
      body,
      (event) => {
        started = true
        onEvent(event)
      },
      signal,
    )
    return { started, error: null }
  } catch (err) {
    if (signal.aborted) return { started, error: null }
    const apiError = toApiError(err)
    return { started, error: { code: apiError.code, params: apiError.params } }
  }
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
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  }
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
  const clientKey = useRef(crypto.randomUUID())
  const sending = useRef(false)

  const detail = useQuery({
    ...sessionQueryOptions(sessionId),
    refetchOnWindowFocus: !busy,
    // Another tab or device may be answering in this conversation: follow along.
    refetchInterval: (query) => (query.state.data?.generating && !busy ? 2000 : false),
  })

  const keyOf = (id: string) => agentSessionGetQueryKey({ path: { id } })

  /** Runs one streaming request; false when it failed before the turn started. */
  async function run(id: string, path: string, body: unknown): Promise<boolean> {
    setBusy(true)
    setError(null)
    const abort = new AbortController()
    controller.current = abort
    const onEvent = (event: AgentEvent) => {
      if (event.event === 'error') {
        setError(event.data)
        return
      }
      queryClient.setQueryData<AgentSessionDetail>(keyOf(id), (current) =>
        current ? applyEvent(current, event) : current,
      )
      if (event.event === 'title') void invalidateOperations(queryClient, LIST_QUERIES)
    }
    const result = await streamTurn(path, body, onEvent, abort.signal)
    if (result.error) setError(result.error)
    controller.current = null
    setBusy(false)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: keyOf(id) }),
      invalidateOperations(queryClient, LIST_QUERIES),
    ])
    return result.started
  }

  async function createSession(scope: AgentScope | null | undefined): Promise<string> {
    const { data } = await agentSessionCreate({
      body: { ...(scope ? { scope } : {}), client_key: clientKey.current },
      throwOnError: true,
    })
    queryClient.setQueryData(keyOf(data.id), emptyDetail(data))
    onCreated(data.id)
    return data.id
  }

  function ensureSession(scope: AgentScope | null | undefined): Promise<string> {
    if (sessionId) return Promise.resolve(sessionId)
    if (!creating.current) {
      creating.current = createSession(scope).catch((err: unknown) => {
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
    setBusy(true)
    const id = await ensureSession(input.scope).catch((err: unknown) => {
      const apiError = toApiError(err)
      setError({ code: apiError.code, params: apiError.params })
      return null
    })
    if (id === null) {
      sending.current = false
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
    const started = await run(id, `/agent/sessions/${id}/messages`, {
      text: input.text,
      attachment_ids: input.attachmentIds ?? [],
      scope: input.scope ?? null,
      skill: input.skill?.name ?? null,
    })
    sending.current = false
    return started
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
      const lastUser = current.messages.findLastIndex((m) => m.role === 'user')
      return { ...current, messages: current.messages.slice(0, lastUser + 1) }
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
